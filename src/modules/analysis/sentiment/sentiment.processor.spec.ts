// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { Job } from 'bullmq';

import { MessageAnalyzedEvent } from '../events/message-analyzed.event';
import { SentimentProcessor } from './sentiment.processor';
import type {
  SentimentAnalysisResult,
  SentimentPayload,
} from './sentiment.type';

/**
 * T1: a skipped analysis (the service yields no result) must never emit
 * `MessageAnalyzedEvent`, so the UI can tell "not analyzed" apart from an
 * analyzed neutral.
 */
describe('SentimentProcessor events (T1)', () => {
  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
  const publish = jest.fn();
  const build = () =>
    new SentimentProcessor(
      { analyzeMessage: jest.fn() } as never,
      logger as never,
      { publish } as never,
    );

  const job = {
    id: 'job-1',
    data: { messageId: 'message-1' },
  } as unknown as Job<SentimentPayload>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs a skipped analysis at debug, without publishing the event', () => {
    build().onCompleted(job, null);

    expect(publish).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      { jobId: 'job-1', messageId: 'message-1' },
      'Sentiment analysis produced no result',
    );
  });

  it('publishes MessageAnalyzedEvent after a completed analysis', () => {
    const result: SentimentAnalysisResult = {
      messageId: 'message-1',
      analysisId: 'analysis-1',
      probabilities: { pos: 0.9, neu: 0.05, neg: 0.05 },
      label: 'positive',
      conversationId: 'conversation-1',
    };

    build().onCompleted(job, result);

    expect(publish).toHaveBeenCalledWith(expect.any(MessageAnalyzedEvent));
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ analysisId: 'analysis-1' }),
    );
  });
});
