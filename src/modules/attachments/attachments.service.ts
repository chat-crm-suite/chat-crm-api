// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { JwtPayload } from '@auth/auth.types';
import { findMembership } from '@auth/membership';
import { ConversationAccessService } from '../conversations/realtime/conversation-access.service';
import { buildAttachmentUrl } from '../message/attachment-url';
import type { MessageAttachment } from '../message/entities/message-attachment.entity';
import type { Message } from '../message/entities/message.entity';
import type { MessageAttachmentContext } from '../message/message.repository';
import { MessageService } from '../message/message.service';
import { isAllowedMime, normalizeMime } from './attachment-mime';
import {
  AttachmentSignatureService,
  type AttachmentGrant,
} from './attachment-signature.service';
import { AttachmentStorageService } from '../media/attachment-storage.service';

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
 * - Session access derives the company from the attachment, requires it in
 *   the token's memberships and reuses the `ConversationAccessService` the
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

  /**
   * Session path. A browser loads media through `<img>`/`<audio>`, which
   * cannot send `x-company-id`, so the company comes from the attachment row
   * (server-side data) and must be one of the verified token's memberships.
   * The role rules then run through the same `ConversationAccessService` as
   * the socket room join. A client-supplied company that disagrees is denied.
   */
  async authorizeForSession(
    attachmentId: string,
    user: Pick<JwtPayload, 'sub' | 'memberships'> | null | undefined,
    requestedCompanyId?: string | null,
  ): Promise<ResolvedAttachment> {
    if (!user?.sub) throw new ForbiddenException('Session required');

    const context = await this.messages.findAttachmentContext(attachmentId);
    if (!context) throw new NotFoundException('Attachment not found');

    const companyId = context.message.companyId;
    if (requestedCompanyId && requestedCompanyId !== companyId) {
      throw new ForbiddenException('Attachment belongs to another company');
    }
    if (!findMembership(user, companyId)) {
      throw new ForbiddenException('Not a member of this company');
    }

    await this.access.assertCanJoinConversation(context.message.conversationId, {
      userId: user.sub,
      companyId,
      authenticated: true,
    });

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
