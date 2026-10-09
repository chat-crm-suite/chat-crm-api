// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { FindOperator } from 'typeorm';

import { WhatsAppIntakeService } from './whatsapp-intake.service';

/**
 * Ticket #19 spec decision: durable `replayed` intake events get a time-based
 * purge, while `pending` ones are still recovery material and must survive.
 * Exercised at the service seam with a mocked repository (unit only: no DB).
 */
const build = () => {
  const events = {
    delete: jest.fn<Promise<{ affected: number }>, [unknown]>(),
  };
  events.delete.mockResolvedValue({ affected: 3 });
  const logger = { debug: jest.fn(), warn: jest.fn() };
  const service = new WhatsAppIntakeService(events as never, logger as never);

  return { service, events, logger };
};

const DAY_MS = 24 * 60 * 60 * 1000;

describe('WhatsAppIntakeService.purgeReplayed (ticket #19 TTL purge)', () => {
  it('deletes only replayed events older than the retention window', async () => {
    const { service, events } = build();

    await expect(service.purgeReplayed(7 * DAY_MS)).resolves.toBe(3);

    expect(events.delete).toHaveBeenCalledTimes(1);
    const where = events.delete.mock.calls[0][0] as {
      status: string;
      updatedAt: FindOperator<Date>;
    };
    // Pending rows are never candidates: only acknowledged events are purged.
    expect(where.status).toBe('replayed');
    expect(where.updatedAt).toBeInstanceOf(FindOperator);
    expect(where.updatedAt.type).toBe('lessThan');
    const cutoff = where.updatedAt.value;
    const expected = Date.now() - 7 * DAY_MS;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000);
  });

  it('reports zero and logs nothing when no row matches', async () => {
    const { service, events, logger } = build();
    events.delete.mockResolvedValue({ affected: 0 });

    await expect(service.purgeReplayed()).resolves.toBe(0);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('runs a best-effort purge on bootstrap without rejecting', async () => {
    const { service, events, logger } = build();
    events.delete.mockRejectedValue(new Error('db down'));

    expect(() => service.onApplicationBootstrap()).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.warn).toHaveBeenCalled();
  });

  it('purges on bootstrap', () => {
    const { service, events } = build();
    const purge = jest.spyOn(service, 'purgeReplayed').mockResolvedValue(0);

    service.onApplicationBootstrap();

    expect(purge).toHaveBeenCalled();
    expect(events.delete).not.toHaveBeenCalled();
  });
});
