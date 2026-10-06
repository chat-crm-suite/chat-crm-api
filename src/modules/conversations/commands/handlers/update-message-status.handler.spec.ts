import type { Message } from '../../../message/entities/message.entity';
import type { MessageService } from '../../../message/message.service';
import type { ConversationFanoutService } from '../../realtime/conversation-fanout.service';
import { UpdateMessageStatusCommand } from '../update-message-status.command';
import { UpdateMessageStatusHandler } from './update-message-status.handler';

/**
 * T4 live patch, now through the T6 single fanout path: an applied delivery
 * state reaches the open thread and the assignee (preview). Unknown wamids and
 * regressions (not applied by the message service) emit nothing.
 */
describe('UpdateMessageStatusHandler', () => {
  const occurredAt = new Date('2026-10-05T12:00:00.000Z');
  const applyDeliveryStatus = jest.fn();
  const emitStatusPatch = jest.fn().mockResolvedValue(undefined);
  const logger = { debug: jest.fn(), setContext: jest.fn() };

  const handler = new UpdateMessageStatusHandler(
    { applyDeliveryStatus } as unknown as MessageService,
    { emitStatusPatch } as unknown as ConversationFanoutService,
    logger as never,
  );

  const message = (overrides: Partial<Message> = {}): Message =>
    ({
      id: 'msg-1',
      conversationId: 'conv-1',
      clientMessageId: 'client-1',
      status: 'delivered',
      statusUpdatedAt: occurredAt,
      errorCode: null,
      errorMessage: null,
      ...overrides,
    }) as Message;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies the state and pushes the patch through the fanout', async () => {
    applyDeliveryStatus.mockResolvedValue({
      applied: true,
      message: message(),
    });

    await handler.execute(
      new UpdateMessageStatusCommand('wamid-out-1', 'delivered', occurredAt),
    );

    expect(applyDeliveryStatus).toHaveBeenCalledWith({
      wamid: 'wamid-out-1',
      status: 'delivered',
      occurredAt,
      errorCode: null,
      errorMessage: null,
    });
    expect(emitStatusPatch).toHaveBeenCalledWith({
      id: 'msg-1',
      conversationId: 'conv-1',
      clientMessageId: 'client-1',
      status: 'delivered',
      at: occurredAt,
      errorCode: null,
      errorMessage: null,
    });
  });

  it('carries the error of a failed state in the patch', async () => {
    applyDeliveryStatus.mockResolvedValue({
      applied: true,
      message: message({
        status: 'failed',
        errorCode: '131047',
        errorMessage: 'Re-engagement message',
      }),
    });

    await handler.execute(
      new UpdateMessageStatusCommand('wamid-out-1', 'failed', occurredAt, {
        code: '131047',
        message: 'Re-engagement message',
      }),
    );

    expect(emitStatusPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorCode: '131047',
        errorMessage: 'Re-engagement message',
      }),
    );
  });

  it('emits nothing for an unmatched wamid or an ignored regression', async () => {
    applyDeliveryStatus.mockResolvedValue({ applied: false, message: null });

    await handler.execute(
      new UpdateMessageStatusCommand('wamid-ghost', 'delivered', occurredAt),
    );

    expect(emitStatusPatch).not.toHaveBeenCalled();
  });
});
