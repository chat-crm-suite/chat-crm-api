// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { SendConversationMessageDto } from '../../../modules/conversations/dto/send-conversation-message.dto';
import { MessageSavedEvent } from '../../../modules/conversations/events/message-saved.event';
import type { Message } from '../../../modules/message/entities/message.entity';
import { AgentMessageSender } from './agent-message-sender.service';

/**
 * T5 outbound pipeline: the row is saved pending first and Graph is called
 * exactly once per client send. A stalled BullMQ retry is the exception: the
 * original attempt died, so the still-`pending` row is sent again instead of
 * staying pending forever. A fresh duplicate never triggers a second call.
 */
const data = {
  room: 'conv-1',
  companyId: 'co-1',
  to: '+15551234567',
  sender: { id: 'user-1', type: 'member' },
  clientMessageId: 'client-1',
  msg: { type: 'text', content: { body: 'hola' } },
} as unknown as SendConversationMessageDto;

const message = (overrides: Partial<Message> = {}): Message =>
  ({
    id: 'msg-1',
    conversationId: 'conv-1',
    clientMessageId: 'client-1',
    status: 'pending',
    ...overrides,
  }) as Message;

function build() {
  const conversations = { saveOutbound: jest.fn() };
  const messages = { markSent: jest.fn(), markSendFailed: jest.fn() };
  const whatsapp = { deliverMessage: jest.fn() };
  const fanout = { emitStatusPatch: jest.fn(), emitError: jest.fn() };
  const eventBus = { publish: jest.fn() };
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };

  const sender = new AgentMessageSender(
    conversations as never,
    messages as never,
    whatsapp as never,
    fanout as never,
    eventBus as never,
    logger as never,
  );

  return {
    sender,
    conversations,
    messages,
    whatsapp,
    fanout,
    eventBus,
    logger,
  };
}

describe('AgentMessageSender stalled retries (T5)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends and broadcasts a freshly created row', async () => {
    const { sender, conversations, messages, whatsapp, fanout, eventBus } =
      build();
    const pending = message();
    conversations.saveOutbound.mockResolvedValue({
      message: pending,
      created: true,
    });
    whatsapp.deliverMessage.mockResolvedValue({
      ok: true,
      response: { messages: [{ id: 'wamid-1' }] },
    });
    messages.markSent.mockResolvedValue(
      message({ status: 'sent', externalId: 'wamid-1' }),
    );

    await sender.send(data, { attemptsMade: 0 });

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.any(MessageSavedEvent),
    );
    expect(whatsapp.deliverMessage).toHaveBeenCalledTimes(1);
    expect(messages.markSent).toHaveBeenCalledWith('msg-1', 'wamid-1');
    expect(fanout.emitStatusPatch).toHaveBeenCalled();
  });

  it('ignores a fresh duplicate without calling Graph again', async () => {
    const { sender, conversations, whatsapp, eventBus } = build();
    const existing = message();
    conversations.saveOutbound.mockResolvedValue({
      message: existing,
      created: false,
    });

    await expect(sender.send(data, { attemptsMade: 0 })).resolves.toBe(
      existing,
    );

    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(whatsapp.deliverMessage).not.toHaveBeenCalled();
  });

  it('sends the still-pending row when a stalled job retries', async () => {
    const { sender, conversations, messages, whatsapp, eventBus } = build();
    const pending = message();
    conversations.saveOutbound.mockResolvedValue({
      message: pending,
      created: false,
    });
    whatsapp.deliverMessage.mockResolvedValue({
      ok: true,
      response: { messages: [{ id: 'wamid-1' }] },
    });
    messages.markSent.mockResolvedValue(
      message({ status: 'sent', externalId: 'wamid-1' }),
    );

    await sender.send(data, { attemptsMade: 1 });

    expect(whatsapp.deliverMessage).toHaveBeenCalledTimes(1);
    expect(messages.markSent).toHaveBeenCalledWith('msg-1', 'wamid-1');
    // The first attempt already broadcast the pending row.
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('ignores a retry when the row already moved past pending', async () => {
    const { sender, conversations, messages, whatsapp } = build();
    const sent = message({ status: 'sent', externalId: 'wamid-1' });
    conversations.saveOutbound.mockResolvedValue({
      message: sent,
      created: false,
    });

    await expect(sender.send(data, { attemptsMade: 2 })).resolves.toBe(sent);

    expect(whatsapp.deliverMessage).not.toHaveBeenCalled();
    expect(messages.markSent).not.toHaveBeenCalled();
  });
});
