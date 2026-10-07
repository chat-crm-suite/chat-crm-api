// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { NotFoundException } from '@nestjs/common';

import type { SentimentClient } from './sentiment.client';
import type { SentimentRepository } from './sentiment.repository';
import { SentimentService } from './sentiment.service';

/**
 * T4: `getConversationSentiment` maps the persisted aggregate into the shared
 * contract: the averages and count pass through, the dominant tone is the
 * highest average (empty conversations stay neutral), and the read is scoped
 * to the caller's company (unknown or foreign ids are a 404).
 */
describe('SentimentService.getConversationSentiment (T4)', () => {
  const aggregateConversationSentiment = jest.fn();
  const conversationBelongsToCompany = jest.fn();

  const build = () =>
    new SentimentService(
      {
        aggregateConversationSentiment,
        conversationBelongsToCompany,
      } as unknown as SentimentRepository,
      {} as never,
      { setContext: jest.fn() } as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    conversationBelongsToCompany.mockResolvedValue(true);
  });

  it('returns the persisted averages and analyzed count', async () => {
    aggregateConversationSentiment.mockResolvedValue({
      avgPos: 0.72,
      avgNeu: 0.2,
      avgNeg: 0.08,
      totalMessages: 12,
    });

    await expect(
      build().getConversationSentiment('conv-1', 'company-1'),
    ).resolves.toEqual({
      avgPos: 0.72,
      avgNeu: 0.2,
      avgNeg: 0.08,
      totalMessages: 12,
      dominant: 'POS',
    });
    expect(conversationBelongsToCompany).toHaveBeenCalledWith(
      'conv-1',
      'company-1',
    );
    expect(aggregateConversationSentiment).toHaveBeenCalledWith(
      'conv-1',
      'company-1',
    );
  });

  it.each([
    { scores: { avgPos: 0.6, avgNeu: 0.3, avgNeg: 0.1 }, dominant: 'POS' },
    { scores: { avgPos: 0.1, avgNeu: 0.7, avgNeg: 0.2 }, dominant: 'NEU' },
    { scores: { avgPos: 0.1, avgNeu: 0.2, avgNeg: 0.7 }, dominant: 'NEG' },
  ])(
    'flags the highest average as dominant ($dominant)',
    async ({ scores, dominant }) => {
      aggregateConversationSentiment.mockResolvedValue({
        ...scores,
        totalMessages: 5,
      });

      await expect(
        build().getConversationSentiment('conv-1', 'company-1'),
      ).resolves.toMatchObject({ dominant });
    },
  );

  it('breaks ties POS > NEG > NEU', async () => {
    aggregateConversationSentiment.mockResolvedValue({
      avgPos: 0.5,
      avgNeu: 0.5,
      avgNeg: 0.5,
      totalMessages: 3,
    });
    await expect(
      build().getConversationSentiment('conv-1', 'company-1'),
    ).resolves.toMatchObject({ dominant: 'POS' });

    aggregateConversationSentiment.mockResolvedValue({
      avgPos: 0,
      avgNeu: 0.5,
      avgNeg: 0.5,
      totalMessages: 2,
    });
    await expect(
      build().getConversationSentiment('conv-1', 'company-1'),
    ).resolves.toMatchObject({ dominant: 'NEG' });
  });

  it('stays neutral when nothing was analyzed', async () => {
    aggregateConversationSentiment.mockResolvedValue({
      avgPos: 0,
      avgNeu: 0,
      avgNeg: 0,
      totalMessages: 0,
    });

    await expect(
      build().getConversationSentiment('conv-1', 'company-1'),
    ).resolves.toEqual({
      avgPos: 0,
      avgNeu: 0,
      avgNeg: 0,
      totalMessages: 0,
      dominant: 'NEU',
    });
  });

  it('throws NotFound when the conversation is unknown or foreign', async () => {
    conversationBelongsToCompany.mockResolvedValue(false);

    await expect(
      build().getConversationSentiment('foreign', 'company-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(aggregateConversationSentiment).not.toHaveBeenCalled();
  });
});

/**
 * T1: IA unavailability is an expected condition. Transport failures (timeout,
 * connection refused) and 5xx responses mark the analysis `skipped` with
 * reason `ia_unavailable` and log at info level, with no sentiment result
 * persisted. Broken-contract responses still fail loudly at error level.
 */
describe('SentimentService.analyzeMessage availability handling (T1)', () => {
  const findMessage = jest.fn();
  const createProcessing = jest.fn();
  const complete = jest.fn();
  const markFailed = jest.fn();
  const markSkipped = jest.fn();
  const analyze = jest.fn();
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  const payload = {
    messageId: 'message-1',
    content: 'hola',
    conversationId: 'conversation-1',
  };

  const build = () =>
    new SentimentService(
      {
        findMessage,
        createProcessing,
        complete,
        markFailed,
        markSkipped,
      } as unknown as SentimentRepository,
      { analyze } as unknown as SentimentClient,
      logger as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    findMessage.mockResolvedValue({
      id: 'message-1',
      conversationId: 'conversation-1',
      companyId: 'company-1',
      body: 'hola',
    });
    createProcessing.mockResolvedValue({ id: 'analysis-1' });
    markFailed.mockResolvedValue(undefined);
    markSkipped.mockResolvedValue(undefined);
  });

  it.each([
    { failure: 'a timeout', error: { name: 'TimeoutError' } },
    { failure: 'a refused connection', error: { code: 'ECONNREFUSED' } },
    { failure: 'a 5xx response', error: { response: { status: 503 } } },
  ])('skips with ia_unavailable on $failure', async ({ error }) => {
    analyze.mockRejectedValue(error);

    await expect(build().analyzeMessage(payload)).resolves.toBeNull();

    expect(markSkipped).toHaveBeenCalledWith('analysis-1', 'ia_unavailable');
    expect(complete).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    { response: {} },
    { response: { label: 'POS' } },
    {
      response: {
        label: 'ham',
        probabilities: { POS: 0.5, NEU: 0.3, NEG: 0.2 },
      },
    },
    {
      response: {
        label: 'POS',
        probabilities: { POS: 0.9, NEU: 0.05 },
      },
    },
  ])('fails on an invalid IA response (%#)', async ({ response }) => {
    analyze.mockResolvedValue(response);

    await expect(build().analyzeMessage(payload)).resolves.toBeNull();

    expect(markFailed).toHaveBeenCalledWith('analysis-1', expect.any(Error));
    expect(markSkipped).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('fails (does not skip) on a 4xx response', async () => {
    analyze.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), {
        response: { status: 400 },
      }),
    );

    await expect(build().analyzeMessage(payload)).resolves.toBeNull();

    expect(markFailed).toHaveBeenCalledWith('analysis-1', expect.any(Error));
    expect(markSkipped).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('completes and maps a valid IA response', async () => {
    analyze.mockResolvedValue({
      text: 'hola',
      label: 'POS',
      probabilities: { POS: 0.9, NEU: 0.05, NEG: 0.05 },
    });

    await expect(build().analyzeMessage(payload)).resolves.toMatchObject({
      messageId: 'message-1',
      analysisId: 'analysis-1',
      label: 'positive',
      probabilities: { pos: 0.9, neu: 0.05, neg: 0.05 },
    });

    expect(complete).toHaveBeenCalledWith(
      'analysis-1',
      expect.objectContaining({ label: 'positive', confidence: 0.9 }),
    );
    expect(markFailed).not.toHaveBeenCalled();
    expect(markSkipped).not.toHaveBeenCalled();
  });
});
