// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ConversationProcessor } from './conversation.processor';

/**
 * T5: the `send-message` job routes through the outbound pipeline that saves
 * the row first (idempotent, pending) and only then talks to Graph. The old
 * after-send save (ConversationMessageSentEvent) is gone, so a send can never
 * persist a second row or fake a `sent`.
 */
describe('ConversationProcessor (T5 outbound)', () => {
  const sender = { send: jest.fn() };
  const eventBus = { publish: jest.fn() };
  const conversations = { saveMsg: jest.fn() };
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };

  const processor = new ConversationProcessor(
    sender as never,
    eventBus as never,
    conversations as never,
    logger as never,
  );

  const sendJobData = {
    room: 'conv-1',
    companyId: 'co-1',
    sender: { id: 'member-1', type: 'member' as const },
    clientMessageId: 'client-1',
    msg: { type: 'text' as const, text: 'hola' },
  };

  beforeEach(() => jest.clearAllMocks());

  it('routes a send-message job through the T5 outbound sender', async () => {
    const saved = { id: 'msg-1' };
    sender.send.mockResolvedValue(saved);

    await expect(
      processor.process({
        name: 'send-message',
        data: sendJobData,
        attemptsMade: 2,
      } as never),
    ).resolves.toBe(saved);

    // A stalled retry must be distinguishable from a fresh duplicate.
    expect(sender.send).toHaveBeenCalledWith(sendJobData, { attemptsMade: 2 });
  });

  it('does not publish a save event after a send job completes', () => {
    processor.onCompleted(
      { name: 'send-message', data: sendJobData } as never,
      { id: 'msg-1' } as never,
    );

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('keeps publishing the saved event for save-message jobs', () => {
    const message = { id: 'msg-1' };

    processor.onCompleted(
      { name: 'save-message', data: sendJobData } as never,
      message as never,
    );

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ message }),
    );
  });
});
