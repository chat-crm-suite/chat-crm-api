// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { Job } from 'bullmq';

import { EnrichMediaProcessor } from './enrich-media.processor';
import type { EnrichMediaJobData } from './enrich-media.queue';
import type { InboundMediaEnrichmentService } from './inbound-media-enrichment.service';

/**
 * T23: the `enrich-media` worker owns the download. It rehydrates the saved
 * row and forwards BullMQ's retry budget (`attemptsMade` + `opts.attempts`) so
 * the enrichment service can tell a retryable fault from an exhausted one.
 */
describe('EnrichMediaProcessor (T23)', () => {
  const logger = { error: jest.fn(), setContext: jest.fn() };

  const build = () => {
    const enrichById = jest.fn().mockResolvedValue(undefined);
    const processor = new EnrichMediaProcessor(
      { enrichById } as unknown as InboundMediaEnrichmentService,
      logger as never,
    );

    return { processor, enrichById };
  };

  const job = (attemptsMade: number, attempts?: number) =>
    ({
      id: 'job-1',
      name: 'enrich-media',
      data: { messageId: 'msg-1' },
      attemptsMade,
      opts: { attempts },
    }) as Job<EnrichMediaJobData>;

  beforeEach(() => jest.clearAllMocks());

  it("forwards the job's attempt budget to the enrichment", async () => {
    const { processor, enrichById } = build();

    await processor.process(job(2, 4));

    expect(enrichById).toHaveBeenCalledWith('msg-1', {
      attemptsMade: 2,
      maxAttempts: 4,
    });
  });

  it('defaults the budget to a single attempt when the job opts omit it', async () => {
    const { processor, enrichById } = build();

    await processor.process(job(0));

    expect(enrichById).toHaveBeenCalledWith('msg-1', {
      attemptsMade: 0,
      maxAttempts: 1,
    });
  });

  it('lets a rethrow surface so BullMQ can schedule the retry', async () => {
    const { processor, enrichById } = build();
    enrichById.mockRejectedValue(new Error('graph 500'));

    await expect(processor.process(job(0, 4))).rejects.toThrow('graph 500');
  });
});
