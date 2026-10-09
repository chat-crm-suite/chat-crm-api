// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';

import { ConversationsModule } from '../conversations/conversations.module';
import { MessageModule } from '../message/message.module';
import { AttachmentSignatureService } from './attachment-signature.service';
import { AttachmentStorageService } from './attachment-storage.service';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

/**
 * T25: private media delivery. Depends on the conversations module only for
 * the shared `ConversationAccessService` (the socket room join access seam)
 * and on the message module for the attachment lookup.
 */
@Module({
  imports: [ConversationsModule, MessageModule],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    AttachmentStorageService,
    AttachmentSignatureService,
  ],
  exports: [AttachmentsService, AttachmentSignatureService],
})
export class AttachmentsModule {}
