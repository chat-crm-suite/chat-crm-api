import { SendAgentMessageCommand } from '../../integrations/whatsapp/commands/send-agent-message.command';
import { ConversationProcessor } from './conversation.processor';

/**
 * T5: the `send-message` job routes through the outbound pipeline that saves
 * the row first (idempotent, pending) and only then talks to Graph. The old
 * after-send save (ConversationMessageSentEvent) is gone, so a send can never
 * persist a second row or fake a `sent`.
 */
describe('ConversationProcessor (T5 outbound)', () => {
  const commandBus = {
    execute: jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue(undefined),
  };
  const eventBus = { publish: jest.fn() };
  const conversations = { saveMsg: jest.fn() };
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };

  const processor = new ConversationProcessor(
    commandBus as never,
    eventBus as never,
    conversations as never,
    logger as never,
  );

  const sendJobData = {
    room: 'conv-1',
    companyId: 'co-1',
    to: '+15551234567',
    sender: { id: 'user-1', type: 'member' as const },
    clientMessageId: 'client-1',
    msg: { type: 'text' as const, content: { body: 'hola' } },
  };

  beforeEach(() => jest.clearAllMocks());

  it('routes a send-message job through the T5 outbound sender', async () => {
    const saved = { id: 'msg-1' };
    commandBus.execute.mockResolvedValue(saved);

    await expect(
      processor.process({
        name: 'send-message',
        data: sendJobData,
        attemptsMade: 2,
      } as never),
    ).resolves.toBe(saved);

    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    const command = commandBus.execute.mock
      .calls[0][0] as SendAgentMessageCommand;
    expect(command).toBeInstanceOf(SendAgentMessageCommand);
    expect(command.data).toBe(sendJobData);
    // A stalled retry must be distinguishable from a fresh duplicate.
    expect(command.attemptsMade).toBe(2);
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
