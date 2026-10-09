// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type {
  ConversationAccessService,
  ConversationSocketIdentity,
} from '../conversations/realtime/conversation-access.service';
import { buildAttachmentUrl } from '../message/attachment-url';
import type { MessageAttachment } from '../message/entities/message-attachment.entity';
import type { Message } from '../message/entities/message.entity';
import type { MessageAttachmentContext } from '../message/message.repository';
import type { MessageService } from '../message/message.service';
import { isAllowedMime, normalizeMime } from './attachment-mime';
import type {
  AttachmentGrant,
  AttachmentSignatureService,
} from './attachment-signature.service';
import type { AttachmentStorageService } from './attachment-storage.service';

/** A storage file cleared for delivery, with our own media URL. */
export interface ResolvedAttachment {
  attachment: MessageAttachment;
  message: Message;
  /** Our own membership-checked URL, never a provider or raw storage path. */
  url: string;
  absolutePath: string;
  mimeType: string;
}

/**
 * T25 attachment authorization.
 *
 * - Session access reuses the exact same `ConversationAccessService` the
 *   socket room join uses, so company isolation and role rules are identical.
 * - A short-lived signed grant (direct-from-storage exposure only) is the
 *   sole alternative to a session; it never widens access beyond its window.
 * - Only `ready` attachments with an allowlisted mime type are served, and
 *   the file always resolves inside the owning company's private storage.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly messages: MessageService,
    private readonly access: ConversationAccessService,
    private readonly storage: AttachmentStorageService,
    private readonly signatures: AttachmentSignatureService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AttachmentsService.name);
  }

  /** Session path: membership-checked, never trusts a client-supplied scope. */
  async authorizeForSession(
    attachmentId: string,
    identity: ConversationSocketIdentity,
  ): Promise<ResolvedAttachment> {
    if (!identity.userId || !identity.companyId) {
      throw new ForbiddenException('Session required');
    }

    const context = await this.messages.findAttachmentContext(attachmentId);
    if (!context) throw new NotFoundException('Attachment not found');

    // Same service as the socket room join: cross-company access is denied.
    await this.access.assertCanJoinConversation(
      context.message.conversationId,
      identity,
    );

    return this.resolve(context);
  }

  /** Direct-from-storage path: valid only inside the short signed window. */
  async authorizeSigned(
    attachmentId: string,
    grant: AttachmentGrant,
  ): Promise<ResolvedAttachment> {
    if (!this.signatures.verify(attachmentId, grant)) {
      this.logger.debug({ attachmentId }, 'Attachment signature rejected');
      throw new ForbiddenException('Invalid or expired attachment signature');
    }

    const context = await this.messages.findAttachmentContext(attachmentId);
    if (!context) throw new NotFoundException('Attachment not found');

    return this.resolve(context);
  }

  private resolve(context: MessageAttachmentContext): ResolvedAttachment {
    const { attachment, message } = context;

    if (attachment.status !== 'ready' || !attachment.storageUrl) {
      throw new NotFoundException('Attachment file not available');
    }

    const mimeType = normalizeMime(attachment.mimeType);
    if (!isAllowedMime(mimeType)) {
      throw new UnsupportedMediaTypeException(
        'Attachment mime type not allowed',
      );
    }

    const absolutePath = this.storage.resolve(
      message.companyId,
      attachment.storageUrl,
    );

    return {
      attachment,
      message,
      url: buildAttachmentUrl(attachment.id) as string,
      absolutePath,
      mimeType,
    };
  }
}
