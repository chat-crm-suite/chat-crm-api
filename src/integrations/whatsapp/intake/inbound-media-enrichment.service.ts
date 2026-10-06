import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { ConversationMessageAttachmentPatch } from '../../../contracts/index';
import {
  ChannelsService,
  type ChannelTransmission,
} from '../../../modules/channels/channels.service';
import { ConversationsService } from '../../../modules/conversations/conversations.service';
import { ConversationFanoutService } from '../../../modules/conversations/realtime/conversation-fanout.service';
import type { MessageAttachment } from '../../../modules/message/entities/message-attachment.entity';
import type { Message } from '../../../modules/message/entities/message.entity';
import { MessageService } from '../../../modules/message/message.service';
import { WhatsAppClient } from '../clients/whatsapp.client';

/**
 * T3 async enrichment: the message row is saved first with a `pending`
 * attachment carrying the provider media reference; this service downloads
 * the file through the owning channel transmission (version/base URL/token
 * from that channel) and stores it under the company folder. Success flips
 * the attachment to `ready` and emits a patch; any failure flips it to
 * `failed` and emits the failed patch. The message row (body/caption) is
 * never deleted or emptied.
 */
@Injectable()
export class InboundMediaEnrichmentService {
  constructor(
    private readonly messages: MessageService,
    private readonly conversations: ConversationsService,
    private readonly channels: ChannelsService,
    private readonly client: WhatsAppClient,
    private readonly fanout: ConversationFanoutService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InboundMediaEnrichmentService.name);
  }

  async enrich(message: Message): Promise<void> {
    const pending = await this.messages.findPendingMediaAttachments(message.id);
    if (!pending.length) return;

    // A failing lookup (decrypt/DB) must settle every pending attachment as
    // failed; otherwise the row keeps a `pending` attachment forever.
    let transmission: ChannelTransmission | null;
    try {
      transmission = await this.resolveTransmission(message);
    } catch (error: unknown) {
      for (const attachment of pending) {
        await this.failAttachment(message, attachment, error);
      }
      return;
    }

    for (const attachment of pending) {
      if (!transmission) {
        await this.failAttachment(
          message,
          attachment,
          new Error('No channel transmission for inbound media'),
        );
        continue;
      }

      await this.enrichAttachment(message, attachment, transmission);
    }
  }

  private async resolveTransmission(
    message: Message,
  ): Promise<ChannelTransmission | null> {
    const conversation = await this.conversations.findOne(
      message.conversationId,
    );
    if (!conversation?.channelId) return null;

    return this.channels.getTransmissionByChannelId(conversation.channelId);
  }

  private async enrichAttachment(
    message: Message,
    attachment: MessageAttachment,
    transmission: ChannelTransmission,
  ): Promise<void> {
    try {
      const downloaded = await this.client.downloadMedia(
        transmission,
        attachment.externalMediaId as string,
        { ext: fileExtension(attachment.fileName) },
      );

      const saved = await this.messages.markAttachmentReady(attachment.id, {
        storageUrl: downloaded.fileUrl,
        mimeType: downloaded.mimeType,
        sizeBytes: downloaded.sizeBytes,
      });

      // A concurrent pass already settled this attachment: no second patch.
      if (!saved) return;

      this.emitPatch(message, saved);
      this.logger.debug(
        { attachmentId: attachment.id, mediaId: attachment.externalMediaId },
        'Inbound media enriched',
      );
    } catch (error: unknown) {
      await this.failAttachment(message, attachment, error);
    }
  }

  private async failAttachment(
    message: Message,
    attachment: MessageAttachment,
    error: unknown,
  ): Promise<void> {
    const saved = await this.messages.markAttachmentFailed(attachment.id);

    if (saved) this.emitPatch(message, saved);

    this.logger.error(
      {
        error,
        attachmentId: attachment.id,
        mediaId: attachment.externalMediaId,
      },
      'Inbound media enrichment failed; row kept with a failed attachment',
    );
  }

  private emitPatch(message: Message, attachment: MessageAttachment): void {
    const patch: ConversationMessageAttachmentPatch = {
      id: message.id,
      conversationId: message.conversationId,
      attachmentId: attachment.id,
      status: attachment.status,
      url: attachment.storageUrl ?? null,
      mimeType: attachment.mimeType ?? null,
      sizeBytes: attachment.sizeBytes ?? null,
      at: new Date(),
    };

    // T6 single fanout path: the conversation room carries the thread, the
    // assignee's personal room carries the preview. A fanout failure must
    // never fail the already-durable enrichment.
    void this.fanout.emitAttachmentPatch(patch).catch((error: unknown) => {
      this.logger.error(
        { error, attachmentId: attachment.id },
        'Attachment patch fanout failed',
      );
    });
  }
}

function fileExtension(fileName?: string): string | undefined {
  return fileName?.split('.').pop() || undefined;
}
