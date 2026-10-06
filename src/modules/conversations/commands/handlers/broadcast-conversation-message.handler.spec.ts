// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ConversationMessagePayload } from '../../../message/message.types';
import type { ConversationFanoutService } from '../../realtime/conversation-fanout.service';
import { BroadcastConversationMessageCommand } from '../broadcast-conversation-message.command';
import { BroadcastConversationMessageHandler } from './broadcast-conversation-message.handler';

/**
 * T6: the live broadcast goes through the single fanout path, so the body
 * reaches the conversation room and the assignee only.
 */
describe('BroadcastConversationMessageHandler (T6)', () => {
  const emitMessage = jest.fn().mockResolvedValue(undefined);
  const logger = { debug: jest.fn(), error: jest.fn(), setContext: jest.fn() };

  const handler = new BroadcastConversationMessageHandler(
    { emitMessage } as unknown as ConversationFanoutService,
    logger as never,
  );

  const payload = {
    id: 'msg-1',
    conversationId: 'conv-1',
    msg: { type: 'text', content: { body: 'hola' } },
  } as ConversationMessagePayload;

  beforeEach(() => jest.clearAllMocks());

  it('delegates the live body to the fanout for its conversation', async () => {
    await expect(
      handler.execute(
        new BroadcastConversationMessageCommand('msg-1', payload, 'conv-1'),
      ),
    ).resolves.toEqual({ id: 'msg-1' });

    expect(emitMessage).toHaveBeenCalledWith('conv-1', payload);
  });

  it('does not emit when the command carries no conversation', async () => {
    await handler.execute(
      new BroadcastConversationMessageCommand('msg-1', payload),
    );

    expect(emitMessage).not.toHaveBeenCalled();
  });
});
