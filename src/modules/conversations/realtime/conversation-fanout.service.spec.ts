// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ConversationSocketEvent } from '../../../contracts/index';
import type { ConversationMessagePayload } from '../../message/message.types';
import type { ConversationAccessService } from './conversation-access.service';
import { ConversationFanoutService } from './conversation-fanout.service';
import type { ConversationGateway } from '../gateways/conversation.gateway';

/**
 * T6 single fanout path: message bodies leave through one method that routes
 * to the conversation room plus the assignee's personal room (excluding the
 * thread room, so a socket in both is not delivered twice). The company room
 * never receives bodies; unassigned conversations only reach their room.
 */
describe('ConversationFanoutService (T6)', () => {
  const emit = jest.fn();
  const except = jest.fn();
  const to = jest.fn();
  except.mockReturnValue({ emit });
  to.mockReturnValue({ emit, except });
  const getActiveAssignee = jest.fn();
  const logger = { debug: jest.fn(), warn: jest.fn(), setContext: jest.fn() };

  const fanout = new ConversationFanoutService(
    { server: { to } } as unknown as ConversationGateway,
    { getActiveAssignee } as unknown as ConversationAccessService,
    logger as never,
  );

  const payload: ConversationMessagePayload = {
    id: 'msg-1',
    conversationId: 'conv-1',
    timestamp: new Date('2026-10-05T12:00:00.000Z'),
    status: 'delivered',
    sender: { id: 'cust-1', type: 'customer' },
    msg: { type: 'text', content: { body: 'hola' } },
  };

  beforeEach(() => jest.clearAllMocks());

  it('emits a body to the conversation room and the assignee, never the company room', async () => {
    getActiveAssignee.mockResolvedValue({
      memberId: 'member-1',
      userId: 'user-9',
    });

    await fanout.emitMessage('conv-1', payload);

    expect(to).toHaveBeenCalledWith('conversation:conv-1');
    expect(to).toHaveBeenCalledWith('user:user-9');
    expect(to).not.toHaveBeenCalledWith(expect.stringContaining('company:'));
    expect(except).toHaveBeenCalledWith('conversation:conv-1');
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.BroadcastMessage,
      payload,
    );
  });

  it('emits only to the conversation room when the conversation is unassigned', async () => {
    getActiveAssignee.mockResolvedValue(null);

    await fanout.emitMessage('conv-1', payload);

    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith('conversation:conv-1');
    expect(except).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('routes the attachment patch through the same conversation + assignee path', async () => {
    const patch = {
      id: 'msg-1',
      conversationId: 'conv-1',
      attachmentId: 'att-1',
      status: 'ready' as const,
      url: '/uploads/a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      at: new Date('2026-10-05T12:40:00.000Z'),
    };
    getActiveAssignee.mockResolvedValue({
      memberId: 'member-1',
      userId: 'user-9',
    });

    await fanout.emitAttachmentPatch(patch);

    expect(to).toHaveBeenCalledWith('conversation:conv-1');
    expect(to).toHaveBeenCalledWith('user:user-9');
    expect(to).not.toHaveBeenCalledWith(expect.stringContaining('company:'));
    expect(except).toHaveBeenCalledWith('conversation:conv-1');
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.MessageAttachment,
      patch,
    );
  });

  it('routes the delivery status patch through the same conversation + assignee path', async () => {
    const patch = {
      id: 'msg-1',
      conversationId: 'conv-1',
      clientMessageId: null,
      status: 'read' as const,
      at: new Date('2026-10-05T12:30:00.000Z'),
      errorCode: null,
      errorMessage: null,
    };
    getActiveAssignee.mockResolvedValue({
      memberId: 'member-1',
      userId: 'user-9',
    });

    await fanout.emitStatusPatch(patch);

    expect(to).toHaveBeenCalledWith('conversation:conv-1');
    expect(to).toHaveBeenCalledWith('user:user-9');
    expect(to).not.toHaveBeenCalledWith(expect.stringContaining('company:'));
    expect(except).toHaveBeenCalledWith('conversation:conv-1');
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.MessageStatus,
      patch,
    );
  });
});
