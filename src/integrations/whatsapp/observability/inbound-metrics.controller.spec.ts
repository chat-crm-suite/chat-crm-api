// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { InboundMetricsSnapshot } from './inbound-metrics.service';
import { InboundMetricsController } from './inbound-metrics.controller';

/**
 * Ticket #24: the production read seam for the inbound counters. `snapshot()`
 * existed but had no caller; this controller is the single place that exposes
 * it, mirroring the sentiment `GET /metrics`.
 */
describe('InboundMetricsController (ticket #24)', () => {
  const snapshot: InboundMetricsSnapshot = {
    counts: {
      received: 1,
      receivedByType: { text: 1 },
      discarded: 0,
      discardedByType: {},
      discardedByReason: {},
      mediaEnriched: 0,
      mediaFailed: 0,
    },
    gauges: { queueDepth: 0, intakeBacklog: 0 },
    timestamp: '2026-10-08T00:00:00.000Z',
  };

  it('returns the inbound metrics snapshot from the service', async () => {
    const metrics = { snapshot: jest.fn().mockResolvedValue(snapshot) };
    const controller = new InboundMetricsController(metrics as never);

    await expect(controller.snapshot()).resolves.toBe(snapshot);
    expect(metrics.snapshot).toHaveBeenCalledTimes(1);
  });
});
