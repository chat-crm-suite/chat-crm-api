// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, NotFoundException } from '@nestjs/common';

import type {
  ChannelAdapter,
  ChannelOutcome,
} from '@modules/channels/ports/channel-adapter.port';
import { AttachmentStorageService } from '@modules/media/attachment-storage.service';
import type { TemplateHeaderMedia } from '@contracts';
import {
  conversationUploadScope,
  StagedUploadStore,
  templateUploadScope,
  type StagedFile,
} from '@modules/media/staging/staged-upload.store';
import type { MessageAttachment } from '@modules/message/entities/message-attachment.entity';
import { MessageService } from '@modules/message/message.service';
import type { AgentSendJob } from '../commands/send-conversation-message.command';

/** The stored file an outgoing media message carries. */
export interface OutgoingFile {
  storageUrl: string;
  mimeType: string;
  filename: string;
  sizeBytes: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

/**
 * The file side of an agent send: which stored file a message carries (a
 * staged upload, or a sticker the company already has) and its reference at
 * the provider, uploaded once and remembered so retries never re-upload.
 */
@Injectable()
export class OutgoingMediaService {
  constructor(
    private readonly staged: StagedUploadStore,
    private readonly storage: AttachmentStorageService,
    private readonly messages: MessageService,
  ) {}

  /** The file a send references, or `null` for text. */
  async prepare(job: AgentSendJob): Promise<OutgoingFile | null> {
    const { msg } = job;
    const scope = {
      companyId: job.companyId,
      scope: conversationUploadScope(job.room),
    };

    switch (msg.type) {
      case 'text':
        return null;
      case 'image':
      case 'video':
      case 'audio':
      case 'document':
        return fromStaged(
          await this.staged.consume(msg.uploadId, { ...scope, kind: msg.type }),
        );
      case 'sticker':
        return 'uploadId' in msg.source
          ? fromStaged(
              await this.staged.consume(msg.source.uploadId, {
                ...scope,
                kind: 'sticker',
              }),
            )
          : this.storedSticker(msg.source.attachmentId, job.companyId);
    }
  }

  /** A template's header file, staged by `POST /templates/:id/header-upload`. */
  async prepareTemplateHeader(
    uploadId: string,
    scope: { companyId: string; templateId: string; kind: TemplateHeaderMedia },
  ): Promise<OutgoingFile> {
    return fromStaged(
      await this.staged.consume(uploadId, {
        companyId: scope.companyId,
        scope: templateUploadScope(scope.templateId),
        kind: scope.kind,
      }),
    );
  }

  /** Every stored file of a message, oldest first. */
  async attachmentsOf(messageId: string): Promise<MessageAttachment[]> {
    const attachments = await this.messages.findAttachments(messageId);
    return attachments.filter((attachment) => !!attachment.storageUrl);
  }

  /** The file persisted with a message (its first attachment). */
  async attachmentOf(messageId: string): Promise<MessageAttachment | null> {
    const [attachment] = await this.messages.findAttachments(messageId);
    return attachment?.storageUrl ? attachment : null;
  }

  /**
   * The provider's id for the file: the remembered one, or a fresh upload
   * through the channel adapter (then remembered on the attachment row).
   */
  async toProvider(
    adapter: ChannelAdapter,
    target: { channelId: string; companyId: string },
    attachment: MessageAttachment,
  ): Promise<ChannelOutcome<{ providerMediaId: string }>> {
    if (attachment.externalMediaId) {
      return { ok: true, providerMediaId: attachment.externalMediaId };
    }

    const outcome = await adapter.uploadMedia(target.channelId, {
      absolutePath: this.storage.resolve(
        target.companyId,
        attachment.storageUrl,
      ),
      mimeType: attachment.mimeType,
      filename: attachment.fileName ?? 'file',
      sizeBytes: attachment.sizeBytes ?? 0,
    });

    if (outcome.ok) {
      await this.messages.rememberProviderMedia(
        attachment.id,
        outcome.providerMediaId,
      );
    }

    return outcome;
  }

  /** Re-sending a sticker the company holds (received or sent before). */
  private async storedSticker(
    attachmentId: string,
    companyId: string,
  ): Promise<OutgoingFile> {
    const context = await this.messages.findAttachmentContext(attachmentId);
    const attachment = context?.attachment;

    if (
      !context ||
      !attachment?.storageUrl ||
      context.message.companyId !== companyId ||
      attachment.type !== 'sticker' ||
      attachment.status !== 'ready'
    ) {
      throw new NotFoundException('Sticker not found');
    }

    return {
      storageUrl: attachment.storageUrl,
      mimeType: attachment.mimeType,
      filename: attachment.fileName ?? 'sticker.webp',
      sizeBytes: attachment.sizeBytes ?? null,
      durationMs: null,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    };
  }
}

function fromStaged(staged: StagedFile): OutgoingFile {
  return {
    storageUrl: staged.storageUrl,
    mimeType: staged.mimeType,
    filename: staged.filename,
    sizeBytes: staged.sizeBytes,
    durationMs: staged.durationMs,
    width: staged.width,
    height: staged.height,
  };
}
