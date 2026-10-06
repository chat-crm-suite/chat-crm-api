import { ConversationSocketEvent } from '../../../../contracts/index';
import type { Message } from '../../../message/entities/message.entity';
import type { MessageService } from '../../../message/message.service';
import type { ConversationAssignmentService } from '../../assignment/conversation-assignment.service';
import type { ConversationGateway } from '../../gateways/conversation.gateway';
import { UpdateMessageStatusCommand } from '../update-message-status.command';
import { UpdateMessageStatusHandler } from './update-message-status.handler';

/**
 * T4 live patch: an applied delivery state reaches the open thread
 * (`conversation:{id}`) and the assignee (`user:{userId}`) so it is visible
 * without reloading and even without the chat open. Unknown wamids and
 * regressions (not applied by the message service) emit nothing.
 */
describe('UpdateMessageStatusHandler', () => {
  const occurredAt = new Date('2026-10-05T12:00:00.000Z');
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  const applyDeliveryStatus = jest.fn();
  const getActiveAssignment = jest.fn();
  const logger = { debug: jest.fn(), setContext: jest.fn() };

  const handler = new UpdateMessageStatusHandler(
    { applyDeliveryStatus } as unknown as MessageService,
    { getActiveAssignment } as unknown as ConversationAssignmentService,
    { server: { to } } as unknown as ConversationGateway,
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

  it('pushes the state patch to the conversation room and the assignee', async () => {
    applyDeliveryStatus.mockResolvedValue({
      applied: true,
      message: message(),
    });
    getActiveAssignment.mockResolvedValue({ member: { userId: 'user-9' } });

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
    expect(to).toHaveBeenCalledWith('conversation:conv-1');
    expect(to).toHaveBeenCalledWith('user:user-9');
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(ConversationSocketEvent.MessageStatus, {
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
    getActiveAssignment.mockResolvedValue(null);

    await handler.execute(
      new UpdateMessageStatusCommand('wamid-out-1', 'failed', occurredAt, {
        code: '131047',
        message: 'Re-engagement message',
      }),
    );

    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.MessageStatus,
      expect.objectContaining({
        status: 'failed',
        errorCode: '131047',
        errorMessage: 'Re-engagement message',
      }),
    );
  });

  it('emits only the thread patch when the conversation has no assignee', async () => {
    applyDeliveryStatus.mockResolvedValue({
      applied: true,
      message: message(),
    });
    getActiveAssignment.mockResolvedValue(null);

    await handler.execute(
      new UpdateMessageStatusCommand('wamid-out-1', 'delivered', occurredAt),
    );

    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith('conversation:conv-1');
  });

  it('emits nothing for an unmatched wamid or an ignored regression', async () => {
    applyDeliveryStatus.mockResolvedValue({ applied: false, message: null });

    await handler.execute(
      new UpdateMessageStatusCommand('wamid-ghost', 'delivered', occurredAt),
    );

    expect(to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(getActiveAssignment).not.toHaveBeenCalled();
  });
});
