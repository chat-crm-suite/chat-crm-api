// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { InboundMessageDiscardedEvent } from '../events/inbound-message-discarded.event';
import { InboundMessageReceivedEvent } from '../events/inbound-message-received.event';
import { InboundMediaEnrichedEvent } from '../events/inbound-media-enriched.event';
import { InboundMediaFailedEvent } from '../events/inbound-media-failed.event';
import {
  InboundDiscardedMetricsHandler,
  InboundMediaEnrichedMetricsHandler,
  InboundMediaFailedMetricsHandler,
  InboundReceivedMetricsHandler,
} from './inbound-metrics.subscriber';
import type { InboundMetricsService } from './inbound-metrics.service';

/**
 * Ticket #24 metrics subscriber: every domain fact bumps its counter through
 * the recorder, labelled by `type` (and `reason`) only. The high-cardinality
 * correlation ids the facts carry (message/attachment/media ids) must never
 * reach the recorder as labels.
 */
const recorder = () => ({
  recordReceived: jest.fn(),
  recordDiscarded: jest.fn(),
  recordMediaEnriched: jest.fn(),
  recordMediaFailed: jest.fn(),
  snapshot: jest.fn(),
});

const logger = () => ({ warn: jest.fn(), setContext: jest.fn() });

describe('Inbound metrics subscriber (ticket #24)', () => {
  it('counts received messages by type', async () => {
    const metrics = recorder();
    await new InboundReceivedMetricsHandler(
      metrics as unknown as InboundMetricsService,
      logger() as never,
    ).handle(new InboundMessageReceivedEvent('wamid-1', 'text'));

    expect(metrics.recordReceived).toHaveBeenCalledWith('text');
  });

  it('counts discards by type and reason only', async () => {
    const metrics = recorder();
    const handler = new InboundDiscardedMetricsHandler(
      metrics as unknown as InboundMetricsService,
      logger() as never,
    );

    await handler.handle(
      new InboundMessageDiscardedEvent('wamid-1', 'order', 'unknown-type'),
    );

    expect(metrics.recordDiscarded).toHaveBeenCalledTimes(1);
    expect(metrics.recordDiscarded).toHaveBeenCalledWith('order', 'unknown-type');

    // No message identifier leaks into the metric labels.
    const [type, reason] = metrics.recordDiscarded.mock.calls[0] as string[];
    expect([type, reason].join(':')).not.toContain('wamid-1');
  });

  it('counts enriched media by type', async () => {
    const metrics = recorder();
    await new InboundMediaEnrichedMetricsHandler(
      metrics as unknown as InboundMetricsService,
      logger() as never,
    ).handle(
      new InboundMediaEnrichedEvent({
        messageId: 'msg-1',
        attachmentId: 'att-1',
        mediaId: 'media-1',
        type: 'video',
      }),
    );

    expect(metrics.recordMediaEnriched).toHaveBeenCalledWith('video');
  });

  it('counts failed media by type', async () => {
    const metrics = recorder();
    await new InboundMediaFailedMetricsHandler(
      metrics as unknown as InboundMetricsService,
      logger() as never,
    ).handle(
      new InboundMediaFailedEvent(
        {
          messageId: 'msg-1',
          attachmentId: 'att-1',
          mediaId: 'media-1',
          type: 'image',
        },
        true,
        new Error('graph 500'),
      ),
    );

    expect(metrics.recordMediaFailed).toHaveBeenCalledWith('image');
  });

  it('never throws into the event bus when the recorder fails', async () => {
    const metrics = recorder();
    metrics.recordDiscarded.mockImplementation(() => {
      throw new Error('redis down');
    });
    const log = logger();
    const handler = new InboundDiscardedMetricsHandler(
      metrics as unknown as InboundMetricsService,
      log as never,
    );

    await expect(
      handler.handle(
        new InboundMessageDiscardedEvent('wamid-1', 'text', 'invalid-message'),
      ),
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });
});
