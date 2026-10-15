// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { Job, Queue } from 'bullmq';

import {
  SENTIMENT_RETRY_INTERVAL_MS,
  SENTIMENT_RETRY_SCAN_JOB,
  SENTIMENT_RETRY_SCHEDULER_ID,
} from './sentiment-retry.policy';
import { SentimentRetryProcessor } from './sentiment-retry.processor';
import type { SentimentRetryService } from './sentiment-retry.service';

/**
 * T4: the periodic trigger. A BullMQ job scheduler fires the scan every 5
 * minutes; each scheduled job runs exactly one bounded scan, and a scheduler
 * registration failure degrades to a warning instead of taking the app down.
 */
describe('SentimentRetryProcessor (T4)', () => {
  const runOnce = jest.fn();
  const upsertJobScheduler = jest.fn();
  const logger = { setContext: jest.fn(), warn: jest.fn() };

  const build = () =>
    new SentimentRetryProcessor(
      { runOnce } as unknown as SentimentRetryService,
      logger as never,
      { upsertJobScheduler } as unknown as Queue,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    upsertJobScheduler.mockResolvedValue({ id: 'scheduler-1' });
  });

  it('runs one scan per scheduled job', async () => {
    const summary = { due: 2, enqueued: 1 };
    runOnce.mockResolvedValue(summary);

    await expect(
      build().process({ name: SENTIMENT_RETRY_SCAN_JOB } as Job),
    ).resolves.toEqual(summary);
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it('registers the 5-minute scan on bootstrap', async () => {
    await build().onApplicationBootstrap();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      SENTIMENT_RETRY_SCHEDULER_ID,
      { every: SENTIMENT_RETRY_INTERVAL_MS },
      { name: SENTIMENT_RETRY_SCAN_JOB },
    );
  });

  it('warns instead of failing when the schedule cannot be registered', async () => {
    upsertJobScheduler.mockRejectedValue(new Error('redis down'));

    await expect(build().onApplicationBootstrap()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalled();
  });
});
