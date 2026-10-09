// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ForbiddenException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

import type { ConversationAccessService } from '../conversations/realtime/conversation-access.service';
import type { MessageAttachment } from '../message/entities/message-attachment.entity';
import type { Message } from '../message/entities/message.entity';
import type { MessageService } from '../message/message.service';
import type { AttachmentSignatureService } from './attachment-signature.service';
import type { AttachmentStorageService } from './attachment-storage.service';
import { AttachmentsService } from './attachments.service';

const identity = {
  userId: 'user-1',
  companyId: 'co-1',
  authenticated: true,
};

const message = (): Message =>
  ({
    id: 'msg-1',
    conversationId: 'conv-1',
    companyId: 'co-1',
  }) as Message;

const attachment = (
  overrides: Partial<MessageAttachment> = {},
): MessageAttachment =>
  ({
    id: 'att-1',
    messageId: 'msg-1',
    type: 'image',
    mimeType: 'image/jpeg',
    status: 'ready',
    storageUrl: '/uploads/co-1/media-1.jpg',
    ...overrides,
  }) as MessageAttachment;

function build() {
  const messages = { findAttachmentContext: jest.fn() };
  const access = { assertCanJoinConversation: jest.fn() };
  const storage = {
    resolve: jest.fn().mockReturnValue('/root/co-1/media-1.jpg'),
  };
  const signatures = { verify: jest.fn() };
  const logger = { warn: jest.fn(), debug: jest.fn(), setContext: jest.fn() };

  const service = new AttachmentsService(
    messages as unknown as MessageService,
    access as unknown as ConversationAccessService,
    storage as unknown as AttachmentStorageService,
    signatures as unknown as AttachmentSignatureService,
    logger as never,
  );

  return { service, messages, access, storage, signatures, logger };
}

/**
 * T25: media is served only after the same membership check as the socket
 * room join, from the owning company's private storage, with an explicit mime
 * allowlist. Cross-company access and unknown/failed attachments are denied.
 */
describe('AttachmentsService (T25)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('authorizes a member through the same access service as room joins', async () => {
    const { service, messages, access, storage } = build();
    messages.findAttachmentContext.mockResolvedValue({
      attachment: attachment(),
      message: message(),
    });
    access.assertCanJoinConversation.mockResolvedValue({
      room: 'conversation:conv-1',
    });

    const resolved = await service.authorizeForSession('att-1', identity);

    expect(access.assertCanJoinConversation).toHaveBeenCalledWith(
      'conv-1',
      identity,
    );
    expect(storage.resolve).toHaveBeenCalledWith(
      'co-1',
      '/uploads/co-1/media-1.jpg',
    );
    expect(resolved.absolutePath).toBe('/root/co-1/media-1.jpg');
    expect(resolved.url).toBe('/attachments/att-1');
    expect(resolved.mimeType).toBe('image/jpeg');
  });

  it('denies a cross-company attachment when the access service refuses', async () => {
    const { service, messages, access, storage } = build();
    messages.findAttachmentContext.mockResolvedValue({
      attachment: attachment(),
      message: message(),
    });
    access.assertCanJoinConversation.mockRejectedValue(
      new ForbiddenException('Conversation access denied'),
    );

    await expect(
      service.authorizeForSession('att-1', {
        userId: 'user-2',
        companyId: 'co-2',
        authenticated: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.resolve).not.toHaveBeenCalled();
  });

  it('denies a leaked URL without a session before touching storage', async () => {
    const { service, messages, access } = build();

    await expect(
      service.authorizeForSession('att-1', {
        userId: null,
        companyId: null,
        authenticated: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(messages.findAttachmentContext).not.toHaveBeenCalled();
    expect(access.assertCanJoinConversation).not.toHaveBeenCalled();
  });

  it('404s an unknown attachment', async () => {
    const { service, messages } = build();
    messages.findAttachmentContext.mockResolvedValue(null);

    await expect(
      service.authorizeForSession('missing', identity),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a mime type outside the explicit allowlist', async () => {
    const { service, messages, access, storage } = build();
    messages.findAttachmentContext.mockResolvedValue({
      attachment: attachment({ mimeType: 'text/html' }),
      message: message(),
    });
    access.assertCanJoinConversation.mockResolvedValue({
      room: 'conversation:conv-1',
    });

    await expect(
      service.authorizeForSession('att-1', identity),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(storage.resolve).not.toHaveBeenCalled();
  });

  it('404s an attachment whose file is not ready yet', async () => {
    const { service, messages, access } = build();
    messages.findAttachmentContext.mockResolvedValue({
      attachment: attachment({ status: 'pending', storageUrl: undefined }),
      message: message(),
    });
    access.assertCanJoinConversation.mockResolvedValue({
      room: 'conversation:conv-1',
    });

    await expect(
      service.authorizeForSession('att-1', identity),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts a valid signed grant for a direct-from-storage URL', async () => {
    const { service, messages, access, storage, signatures } = build();
    messages.findAttachmentContext.mockResolvedValue({
      attachment: attachment(),
      message: message(),
    });
    signatures.verify.mockReturnValue(true);

    const resolved = await service.authorizeSigned('att-1', {
      expires: '9999999999999',
      sig: 'abc',
    });

    expect(signatures.verify).toHaveBeenCalledWith('att-1', {
      expires: '9999999999999',
      sig: 'abc',
    });
    expect(access.assertCanJoinConversation).not.toHaveBeenCalled();
    expect(storage.resolve).toHaveBeenCalled();
    expect(resolved.url).toBe('/attachments/att-1');
  });

  it('rejects a stale or tampered signed grant without touching storage', async () => {
    const { service, messages, storage, signatures } = build();
    signatures.verify.mockReturnValue(false);

    await expect(
      service.authorizeSigned('att-1', { expires: '1', sig: 'bad' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(messages.findAttachmentContext).not.toHaveBeenCalled();
    expect(storage.resolve).not.toHaveBeenCalled();
  });
});
