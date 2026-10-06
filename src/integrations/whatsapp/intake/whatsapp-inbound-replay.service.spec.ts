import { UpdateMessageStatusCommand } from '../../../modules/conversations/commands/update-message-status.command';
import { ReceiveWhatsAppMessageCommand } from '../commands/receive-whatsapp-message.command';
import { WhatsAppInboundReplayService } from './whatsapp-inbound-replay.service';

/**
 * T2 consumes the T1 pending hook: events persisted before a crash are
 * replayed from their stored payload (never re-parsed from a webhook) into
 * the same receive command, and consumed only once a row is known to exist.
 */
describe('WhatsAppInboundReplayService', () => {
  const textEvent = (overrides: Record<string, unknown> = {}) => ({
    wamid: 'wamid-text-1',
    phoneNumberId: 'phone-1',
    messageType: 'text',
    status: 'pending',
    payload: {
      id: 'wamid-text-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'text',
      text: { body: 'hola' },
    },
    ...overrides,
  });

  const statusEvent = (overrides: Record<string, unknown> = {}) => ({
    wamid: 'wamid-out-1',
    phoneNumberId: 'phone-1',
    messageType: 'delivered',
    kind: 'status:delivered',
    status: 'pending',
    payload: {
      id: 'wamid-out-1',
      status: 'delivered',
      timestamp: '1760000001',
      recipient_id: '15551234567',
    },
    ...overrides,
  });

  const build = () => {
    const intake = {
      listPending: jest.fn().mockResolvedValue([]),
      markReplayed: jest.fn().mockResolvedValue(undefined),
    };
    const messages = {
      findByExternalId: jest.fn().mockResolvedValue(null),
    };
    const commandBus = {
      execute: jest
        .fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue(undefined),
    };
    const logger = {
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      setContext: jest.fn(),
    };

    const service = new WhatsAppInboundReplayService(
      intake as never,
      messages as never,
      commandBus as never,
      logger as never,
    );

    return { service, intake, messages, commandBus, logger };
  };

  it('replays a pending event from its stored payload and consumes it', async () => {
    const { service, intake, commandBus } = build();
    intake.listPending.mockResolvedValue([textEvent()]);

    await expect(service.replayPending(25)).resolves.toBe(1);

    expect(intake.listPending).toHaveBeenCalledWith(25);
    expect(commandBus.execute).toHaveBeenCalledTimes(1);

    const command = commandBus.execute.mock
      .calls[0][0] as ReceiveWhatsAppMessageCommand;
    expect(command).toBeInstanceOf(ReceiveWhatsAppMessageCommand);
    expect(command.message.context).toMatchObject({
      messageId: 'wamid-text-1',
      phoneNumberId: 'phone-1',
      from: '15551234567',
    });
    expect(command.message.content).toMatchObject({
      type: 'text',
      text: { body: 'hola' },
    });
    expect(intake.markReplayed).toHaveBeenCalledWith('wamid-text-1', 'message');
  });

  it('replays media events with their stored media reference', async () => {
    const { service, intake, commandBus } = build();
    intake.listPending.mockResolvedValue([
      textEvent({
        wamid: 'wamid-audio-1',
        messageType: 'audio',
        payload: {
          id: 'wamid-audio-1',
          from: '15551234567',
          timestamp: '1760000001',
          type: 'audio',
          audio: { id: 'media-audio-1', mime_type: 'audio/ogg' },
        },
      }),
    ]);

    await service.replayPending();

    const command = commandBus.execute.mock
      .calls[0][0] as ReceiveWhatsAppMessageCommand;
    expect(command.message.content).toMatchObject({
      type: 'audio',
      audio: { id: 'media-audio-1', mime_type: 'audio/ogg' },
    });
    expect(intake.markReplayed).toHaveBeenCalledWith(
      'wamid-audio-1',
      'message',
    );
  });

  it('drains every page of the crash backlog until the store is empty', async () => {
    const { service, intake, commandBus } = build();
    intake.listPending
      .mockResolvedValueOnce([
        textEvent({ wamid: 'wamid-page-1' }),
        textEvent({ wamid: 'wamid-page-2' }),
      ])
      .mockResolvedValueOnce([textEvent({ wamid: 'wamid-page-3' })])
      .mockResolvedValue([]);

    await expect(service.replayPending(2)).resolves.toBe(3);

    expect(intake.listPending).toHaveBeenCalledTimes(2);
    expect(intake.listPending).toHaveBeenNthCalledWith(1, 2);
    expect(intake.listPending).toHaveBeenNthCalledWith(2, 2);
    expect(commandBus.execute).toHaveBeenCalledTimes(3);
    expect(intake.markReplayed).toHaveBeenCalledWith('wamid-page-3', 'message');
  });

  it('stops paging when a full page cannot be consumed (failed events stay pending)', async () => {
    const { service, intake, commandBus } = build();
    intake.listPending.mockResolvedValue([
      textEvent({ wamid: 'wamid-stuck-1' }),
      textEvent({ wamid: 'wamid-stuck-2' }),
    ]);
    commandBus.execute.mockRejectedValue(new Error('broker down'));

    await expect(service.replayPending(2)).resolves.toBe(0);

    expect(intake.listPending).toHaveBeenCalledTimes(1);
  });

  it('applies a pending status tick through the update-status path and consumes it', async () => {
    const { service, intake, messages, commandBus } = build();
    intake.listPending.mockResolvedValue([statusEvent()]);

    await expect(service.replayPending()).resolves.toBe(1);

    expect(messages.findByExternalId).not.toHaveBeenCalled();
    const command = commandBus.execute.mock
      .calls[0][0] as UpdateMessageStatusCommand;
    expect(command).toBeInstanceOf(UpdateMessageStatusCommand);
    expect(command).toMatchObject({
      wamid: 'wamid-out-1',
      status: 'delivered',
    });
    expect(command.occurredAt).toEqual(new Date(1_760_000_001_000));
    expect(intake.markReplayed).toHaveBeenCalledWith(
      'wamid-out-1',
      'status:delivered',
    );
  });

  it('replays a failed status tick with its provider error', async () => {
    const { service, intake, commandBus } = build();
    intake.listPending.mockResolvedValue([
      statusEvent({
        kind: 'status:failed',
        messageType: 'failed',
        payload: {
          id: 'wamid-out-1',
          status: 'failed',
          timestamp: '1760000002',
          errors: [{ code: 131047, message: 'Re-engagement message' }],
        },
      }),
    ]);

    await service.replayPending();

    const command = commandBus.execute.mock
      .calls[0][0] as UpdateMessageStatusCommand;
    expect(command).toMatchObject({
      wamid: 'wamid-out-1',
      status: 'failed',
      error: { code: '131047', message: 'Re-engagement message' },
    });
    expect(intake.markReplayed).toHaveBeenCalledWith(
      'wamid-out-1',
      'status:failed',
    );
  });

  it('consumes the event without dispatching when the row already exists', async () => {
    const { service, intake, messages, commandBus } = build();
    intake.listPending.mockResolvedValue([textEvent()]);
    messages.findByExternalId.mockResolvedValue({ id: 'msg-1' });

    await service.replayPending();

    expect(messages.findByExternalId).toHaveBeenCalledWith('wamid-text-1');
    expect(commandBus.execute).not.toHaveBeenCalled();
    expect(intake.markReplayed).toHaveBeenCalledWith('wamid-text-1', 'message');
  });

  it('leaves the event pending when replay fails, and keeps processing the rest', async () => {
    const { service, intake, commandBus, logger } = build();
    intake.listPending.mockResolvedValue([
      textEvent({ wamid: 'wamid-fail-1' }),
      textEvent({
        wamid: 'wamid-ok-1',
        payload: {
          id: 'wamid-ok-1',
          from: '1',
          type: 'text',
          text: { body: 'ok' },
        },
      }),
    ]);
    commandBus.execute
      .mockRejectedValueOnce(new Error('broker down'))
      .mockResolvedValueOnce(undefined);

    await service.replayPending();

    expect(intake.markReplayed).toHaveBeenCalledTimes(1);
    expect(intake.markReplayed).toHaveBeenCalledWith('wamid-ok-1', 'message');
    expect(logger.error).toHaveBeenCalled();
  });

  it('consumes unsupported types without a row to avoid an endless replay', async () => {
    const { service, intake, messages, commandBus, logger } = build();
    intake.listPending.mockResolvedValue([
      textEvent({
        wamid: 'wamid-order-1',
        messageType: 'order',
        payload: { id: 'wamid-order-1', from: '1', type: 'order' },
      }),
    ]);

    await service.replayPending();

    expect(messages.findByExternalId).not.toHaveBeenCalled();
    expect(commandBus.execute).not.toHaveBeenCalled();
    expect(intake.markReplayed).toHaveBeenCalledWith(
      'wamid-order-1',
      'message',
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('consumes a malformed stored payload without crashing the pass', async () => {
    const { service, intake, commandBus } = build();
    intake.listPending.mockResolvedValue([textEvent({ payload: null })]);

    await expect(service.replayPending()).resolves.toBe(0);

    expect(commandBus.execute).not.toHaveBeenCalled();
    expect(intake.markReplayed).toHaveBeenCalledWith('wamid-text-1', 'message');
  });

  it('runs a replay pass on application bootstrap', () => {
    const { service } = build();
    const replay = jest.spyOn(service, 'replayPending').mockResolvedValue(0);

    service.onApplicationBootstrap();

    expect(replay).toHaveBeenCalled();
  });

  it('never rejects on bootstrap when the pass fails', async () => {
    const { service, intake, logger } = build();
    intake.listPending.mockRejectedValue(new Error('db down'));

    expect(() => service.onApplicationBootstrap()).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.error).toHaveBeenCalled();
  });
});
