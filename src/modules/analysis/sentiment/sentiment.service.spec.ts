// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { NotFoundException } from '@nestjs/common';

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
