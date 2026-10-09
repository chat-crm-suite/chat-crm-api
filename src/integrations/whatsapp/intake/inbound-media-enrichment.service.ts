// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
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
import {
  classifyWhatsAppError,
  WhatsAppClient,
} from '../clients/whatsapp.client';
import { InboundMediaEnrichedEvent } from '../events/inbound-media-enriched.event';
import { InboundMediaFailedEvent } from '../events/inbound-media-failed.event';
import {
  ENRICH_MEDIA_TIMEOUT_MS,
  type EnrichMediaAttempt,
  isLastAttempt,
  maxBytesForAttachmentType,
} from './enrich-media.queue';

/**
 * T23 async enrichment worker side: the message row is saved first with a
 * `pending` attachment carrying the provider media reference; the
 * `enrich-media` queue job downloads the file through the owning channel
 * transmission (version/base URL/token from that channel) with a per-type
 * size limit and a timeout, stores it under the company folder, and flips the
 * attachment to `ready` (or `failed`, keeping the row and caption) with a
 * single patch over the fanout path.
 *
 * Retry semantics: a retryable transport fault rethrows while the BullMQ
 * budget still has attempts left, so the job never marks a transient failure
 * as terminal. Only the last attempt (or a terminal fault, e.g. an oversized
 * file) settles the attachment as `failed`. A retry over an already settled
 * attachment is a noop: `findPendingMediaAttachments` no longer sees it and
 * the compare-and-set transitions return `null`, so no second patch is ever
 * emitted. The message row (body/caption) is never deleted or emptied.
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
    private readonly eventBus: EventBus,
  ) {
    this.logger.setContext(InboundMediaEnrichmentService.name);
  }

  /** T23 worker entry: rehydrate the durable row and enrich its media. */
  async enrichById(
    messageId: string,
    attempt: EnrichMediaAttempt,
  ): Promise<void> {
    const message = await this.messages.findById(messageId);
    if (!message) {
      this.logger.warn(
        { messageId },
        'Inbound media enrichment: saved row no longer exists',
      );
      return;
    }

    await this.enrich(message, attempt);
  }

  async enrich(
    message: Message,
    attempt: EnrichMediaAttempt = { attemptsMade: 0, maxAttempts: 1 },
  ): Promise<void> {
    const pending = await this.messages.findPendingMediaAttachments(message.id);

    // Settled (or already failed) attachment: an idempotent retry is a noop.
    if (!pending.length) return;

    // A failing lookup (decrypt/DB) must settle every pending attachment as
    // failed; otherwise the row keeps a `pending` attachment forever. A
    // retryable lookup fault rethrows while the budget has attempts left.
    let transmission: ChannelTransmission | null;
    try {
      transmission = await this.resolveTransmission(message);
    } catch (error: unknown) {
      if (shouldRetry(error, attempt)) throw error;

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

      await this.enrichAttachment(message, attachment, transmission, attempt);
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
    attempt: EnrichMediaAttempt,
  ): Promise<void> {
    try {
      const downloaded = await this.client.downloadMedia(
        transmission,
        attachment.externalMediaId as string,
        {
          ext: fileExtension(attachment.fileName),
          maxBytes: maxBytesForAttachmentType(attachment.type),
          timeoutMs: ENRICH_MEDIA_TIMEOUT_MS,
        },
      );

      const saved = await this.messages.markAttachmentReady(attachment.id, {
        storageUrl: downloaded.fileUrl,
        mimeType: downloaded.mimeType,
        sizeBytes: downloaded.sizeBytes,
      });

      // A concurrent pass already settled this attachment: no second patch.
      if (!saved) return;

      this.emitPatch(message, saved);
      this.publish(
        new InboundMediaEnrichedEvent(
          message.id,
          attachment.id,
          attachment.externalMediaId as string,
          attachment.type,
        ),
      );
    } catch (error: unknown) {
      // Retryable and still within budget: rethrow so BullMQ schedules the
      // next attempt instead of settling a transient fault as terminal.
      if (shouldRetry(error, attempt)) throw error;

      await this.failAttachment(message, attachment, error);
    }
  }

  private async failAttachment(
    message: Message,
    attachment: MessageAttachment,
    error: unknown,
  ): Promise<void> {
    const saved = await this.messages.markAttachmentFailed(attachment.id);

    // A concurrent pass already settled it: no second patch.
    if (saved) this.emitPatch(message, saved);

    this.publish(
      new InboundMediaFailedEvent(
        message.id,
        attachment.id,
        attachment.externalMediaId as string,
        attachment.type,
        classifyWhatsAppError(error).retryable,
        error,
      ),
    );
  }

  /**
   * Publishes one domain fact for the log handlers and the metrics subscriber
   * (ticket #24), never letting a handler failure bubble into enrichment. The
   * row is already durable either way.
   */
  private publish(event: object): void {
    try {
      void Promise.resolve(this.eventBus.publish(event as never)).catch(
        (error: unknown) =>
          this.logger.error(
            { error },
            'Inbound media observability fact could not be published',
          ),
      );
    } catch (error: unknown) {
      this.logger.error(
        { error },
        'Inbound media observability fact could not be published',
      );
    }
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

/** A retryable transport fault only retries while the budget has attempts. */
function shouldRetry(error: unknown, attempt: EnrichMediaAttempt): boolean {
  return !isLastAttempt(attempt) && classifyWhatsAppError(error).retryable;
}

function fileExtension(fileName?: string): string | undefined {
  return fileName?.split('.').pop() || undefined;
}
