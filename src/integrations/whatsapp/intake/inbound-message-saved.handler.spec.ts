// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MessageSavedEvent } from '../../../modules/conversations/events/message-saved.event';
import { InboundMessageSavedHandler } from './inbound-message-saved.handler';

/**
 * T2: a persisted inbound row consumes its pending intake event, so the
 * recovery hook only ever replays what still has no row.
 */
describe('InboundMessageSavedHandler', () => {
  const build = () => {
    const intake = { markReplayed: jest.fn().mockResolvedValue(undefined) };
    const logger = { error: jest.fn(), setContext: jest.fn() };
    const handler = new InboundMessageSavedHandler(
      intake as never,
      logger as never,
    );

    return { handler, intake, logger };
  };

  const event = (externalId?: string) =>
    new MessageSavedEvent({ id: 'msg-1', externalId } as never, 'co-1');

  it('consumes the pending inbound event once its row is saved', async () => {
    const { handler, intake } = build();

    await handler.handle(event('wamid-1'));

    expect(intake.markReplayed).toHaveBeenCalledWith('wamid-1');
  });

  it('ignores rows without a provider message id', async () => {
    const { handler, intake } = build();

    await handler.handle(event(undefined));

    expect(intake.markReplayed).not.toHaveBeenCalled();
  });

  it('never throws when consuming fails', async () => {
    const { handler, intake, logger } = build();
    intake.markReplayed.mockRejectedValue(new Error('db down'));

    await expect(handler.handle(event('wamid-1'))).resolves.toBeUndefined();

    expect(intake.markReplayed).toHaveBeenCalledWith('wamid-1');
    expect(logger.error).toHaveBeenCalled();
  });
});
