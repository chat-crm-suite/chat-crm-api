// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { Queue } from 'bullmq';

import { Analysis } from '../entities/analysis.entity';
import { CircuitBreakerService } from '../ia/circuit-breaker.service';
import { KillSwitchService } from '../ia/kill-switch.service';
import { SENTIMENT_JOB } from './sentiment.constants';
import type { SentimentMetricsService } from './sentiment-metrics.service';
import { SENTIMENT_RETRY_BATCH_SIZE } from './sentiment-retry.policy';
import { SentimentRetryService } from './sentiment-retry.service';
import type { SentimentRepository } from './sentiment.repository';
import type { SentimentPayload } from './sentiment.type';

/**
 * T4: one deferred-retry scan. The worker only re-enqueues skips caused by
 * real unavailability whose retry is due, and only while the kill switch is on
 * and the breaker is not open; it walks the 5m → 24h backoff, stops after 8
 * attempts and never touches `kill_switch` skips or `failed` analyses.
 */
describe('SentimentRetryService (T4)', () => {
  const findDueRetries = jest.fn();
  const scheduleRetryAttempt = jest.fn();
  const add = jest.fn();
  const isEnabled = jest.fn();
  const isOpen = jest.fn();
  const metrics = {
    recordRetryEnqueued: jest.fn(),
  };
  const logger = {
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const NOW = new Date('2026-10-07T12:00:00.000Z');

  const build = () =>
    new SentimentRetryService(
      {
        findDueRetries,
        scheduleRetryAttempt,
      } as unknown as SentimentRepository,
      { add } as unknown as Queue<SentimentPayload>,
      logger as never,
      { isEnabled } as unknown as KillSwitchService,
      { isOpen } as unknown as CircuitBreakerService,
      metrics as unknown as SentimentMetricsService,
    );

  const candidate = (overrides: Partial<Analysis> = {}): Analysis =>
    ({
      id: 'analysis-1',
      status: 'skipped',
      skipReason: 'ia_unavailable',
      retryCount: 0,
      messageId: 'message-1',
      conversationId: 'conversation-1',
      ...overrides,
    }) as Analysis;

  beforeEach(() => {
    jest.clearAllMocks();
    isEnabled.mockResolvedValue(true);
    isOpen.mockResolvedValue(false);
    findDueRetries.mockResolvedValue([]);
    scheduleRetryAttempt.mockResolvedValue(true);
    add.mockResolvedValue({ id: 'job-1' });
  });

  it('does nothing while the kill switch is off', async () => {
    isEnabled.mockResolvedValue(false);

    await expect(build().runOnce(NOW)).resolves.toEqual({
      due: 0,
      enqueued: 0,
    });

    expect(findDueRetries).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(metrics.recordRetryEnqueued).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('does nothing while the circuit breaker is open', async () => {
    isOpen.mockResolvedValue(true);

    await expect(build().runOnce(NOW)).resolves.toEqual({
      due: 0,
      enqueued: 0,
    });

    expect(findDueRetries).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('re-enqueues a due unavailability skip with the next backoff', async () => {
    findDueRetries.mockResolvedValue([candidate()]);

    await expect(build().runOnce(NOW)).resolves.toEqual({
      due: 1,
      enqueued: 1,
    });

    expect(findDueRetries).toHaveBeenCalledWith(
      SENTIMENT_RETRY_BATCH_SIZE,
      NOW,
    );
    expect(add).toHaveBeenCalledWith(
      SENTIMENT_JOB,
      {
        messageId: 'message-1',
        conversationId: 'conversation-1',
        analysisId: 'analysis-1',
      },
      { jobId: 'retry|analysis-1|1' },
    );
    // Attempt 1 is on its way; attempt 2 waits 15 minutes.
    expect(scheduleRetryAttempt).toHaveBeenCalledWith(
      'analysis-1',
      0,
      new Date(NOW.getTime() + 900_000),
    );
    // T6: the re-enqueue feeds the `/metrics` retry counter.
    expect(metrics.recordRetryEnqueued).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('never retries kill_switch skips, failed analyses or exhausted rows', async () => {
    findDueRetries.mockResolvedValue([
      candidate({ id: 'manual', skipReason: 'kill_switch' }),
      candidate({ id: 'failed', status: 'failed' }),
      candidate({ id: 'exhausted', retryCount: 8 }),
      candidate({ id: 'no-message', messageId: null }),
    ]);

    await expect(build().runOnce(NOW)).resolves.toEqual({
      due: 4,
      enqueued: 0,
    });

    expect(add).not.toHaveBeenCalled();
    expect(scheduleRetryAttempt).not.toHaveBeenCalled();
  });

  it('enqueues the 8th attempt as the last one and gives up', async () => {
    findDueRetries.mockResolvedValue([candidate({ retryCount: 7 })]);

    await expect(build().runOnce(NOW)).resolves.toEqual({
      due: 1,
      enqueued: 1,
    });

    expect(add).toHaveBeenCalledWith(
      SENTIMENT_JOB,
      expect.objectContaining({ analysisId: 'analysis-1' }),
      { jobId: 'retry|analysis-1|8' },
    );
    expect(scheduleRetryAttempt).toHaveBeenCalledWith('analysis-1', 7, null);
  });

  it('keeps going when a row can no longer be scheduled', async () => {
    findDueRetries.mockResolvedValue([
      candidate({ id: 'analysis-1' }),
      candidate({ id: 'analysis-2', retryCount: 1 }),
    ]);
    scheduleRetryAttempt
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(build().runOnce(NOW)).resolves.toEqual({
      due: 2,
      enqueued: 2,
    });

    expect(add).toHaveBeenCalledTimes(2);
  });

  it('logs and skips a row whose enqueue fails, without scheduling it', async () => {
    findDueRetries.mockResolvedValue([
      candidate({ id: 'analysis-1' }),
      candidate({ id: 'analysis-2' }),
    ]);
    add
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce({ id: 'job-2' });

    await expect(build().runOnce(NOW)).resolves.toEqual({
      due: 2,
      enqueued: 1,
    });

    expect(metrics.recordRetryEnqueued).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
    expect(scheduleRetryAttempt).toHaveBeenCalledTimes(1);
    expect(scheduleRetryAttempt).toHaveBeenCalledWith(
      'analysis-2',
      0,
      expect.any(Date),
    );
  });
});
