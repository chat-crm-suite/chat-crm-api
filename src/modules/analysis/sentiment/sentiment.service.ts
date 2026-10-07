// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type {
  ConversationSentiment,
  SentimentLabel,
} from '../../../contracts/index';
import { SentimentClient } from './sentiment.client';
import { DEFAULT_SENTIMENT_MODEL } from './sentiment.constants';
import { IaContractError, isIaUnavailable } from './sentiment.errors';
import type { SentimentResponse } from './sentiment.interface';
import {
  SentimentRepository,
  type ConversationSentimentAggregate,
} from './sentiment.repository';
import type {
  SentimentAnalysisResult,
  SentimentPayload,
  SentimentProbabilities,
} from './sentiment.type';

type MappedResponse = {
  label: SentimentLabel;
  confidence: number;
  probabilities: SentimentProbabilities;
  model: string;
};

/**
 * Sentiment analysis orchestration: loads the message for company/conversation
 * context (and body fallback), calls the FastAPI client and persists the
 * `analyses` + `sentiment_results` rows. Never throws: IA unavailability marks
 * the analysis `skipped` (reason `ia_unavailable`) and returns null; broken
 * responses or real failures mark it `failed` and also return null.
 */
@Injectable()
export class SentimentService {
  constructor(
    private readonly repo: SentimentRepository,
    private readonly client: SentimentClient,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SentimentService.name);
  }

  async analyzeMessage(
    payload: SentimentPayload,
  ): Promise<SentimentAnalysisResult | null> {
    const message = await this.repo.findMessage(payload.messageId);

    const conversationId = payload.conversationId ?? message?.conversationId;
    const companyId = message?.companyId;
    const content = payload.content || message?.body;

    if (!conversationId || !companyId) {
      this.logger.warn(
        { messageId: payload.messageId, conversationId, companyId },
        'Skipping sentiment analysis: missing conversationId/companyId',
      );
      return null;
    }

    if (!content) {
      this.logger.warn(
        { messageId: payload.messageId, conversationId },
        'Skipping sentiment analysis: empty message content',
      );
      return null;
    }

    const analysis = await this.repo
      .createProcessing({
        companyId,
        messageId: payload.messageId,
        conversationId,
        model: DEFAULT_SENTIMENT_MODEL,
      })
      .catch((error: unknown) => {
        this.logger.error(
          { err: error, messageId: payload.messageId, conversationId },
          'Failed to create sentiment analysis',
        );
        return null;
      });
    if (!analysis) return null;

    const analysisId = analysis.id;

    const response = await this.client
      .analyze(content)
      .catch(async (error: unknown) => {
        if (isIaUnavailable(error)) {
          await this.markSkipped(analysisId, payload, conversationId);
        } else {
          await this.markFailed(analysisId, error, payload, conversationId);
        }

        return null;
      });
    if (response === null) return null;

    try {
      const mapped = this.mapResponse(response);

      await this.repo.complete(analysisId, {
        label: mapped.label,
        confidence: mapped.confidence,
        model: mapped.model,
        probabilities: mapped.probabilities,
        result: { probabilities: mapped.probabilities },
      });

      return {
        messageId: payload.messageId,
        analysisId,
        probabilities: mapped.probabilities,
        label: mapped.label,
        conversationId,
      };
    } catch (error: unknown) {
      await this.markFailed(analysisId, error, payload, conversationId);
      return null;
    }
  }

  /** T1: expected IA unavailability → `skipped` + info log, never an error. */
  private async markSkipped(
    analysisId: string,
    payload: SentimentPayload,
    conversationId: string,
  ): Promise<void> {
    await this.repo
      .markSkipped(analysisId, 'ia_unavailable')
      .catch((markError: unknown) =>
        this.logger.error(
          { err: markError, analysisId },
          'Failed to mark sentiment analysis as skipped',
        ),
      );

    this.logger.info(
      {
        analysisId,
        messageId: payload.messageId,
        conversationId,
        reason: 'ia_unavailable',
      },
      'Sentiment analysis skipped: IA unavailable',
    );
  }

  private async markFailed(
    analysisId: string,
    error: unknown,
    payload: SentimentPayload,
    conversationId: string,
  ): Promise<void> {
    await this.repo
      .markFailed(analysisId, error)
      .catch((markError: unknown) =>
        this.logger.error(
          { err: markError, analysisId },
          'Failed to mark sentiment analysis as failed',
        ),
      );

    this.logger.error(
      { err: error, messageId: payload.messageId, conversationId },
      'Sentiment analysis failed',
    );
  }

  /**
   * T4: per-conversation customer tone for `GET /conversations/:id/sentiment`,
   * built from the persisted analyses and scoped to the caller's company. An
   * unknown id (or one owned by another company) is a 404; an existing
   * conversation without analyses stays neutral with zero averages.
   */
  async getConversationSentiment(
    conversationId: string,
    companyId: string,
  ): Promise<ConversationSentiment> {
    const belongs = await this.repo.conversationBelongsToCompany(
      conversationId,
      companyId,
    );
    if (!belongs) {
      throw new NotFoundException('Conversation not found');
    }

    const aggregate = await this.repo.aggregateConversationSentiment(
      conversationId,
      companyId,
    );

    return {
      ...aggregate,
      dominant: dominantTone(aggregate),
    };
  }

  private mapResponse(response: SentimentResponse): MappedResponse {
    const probabilities = readProbabilities(response?.probabilities);
    const label = normalizeLabel(response?.label);

    if (!label || !probabilities) {
      throw new IaContractError('Unexpected IA response');
    }

    const confidence =
      label === 'positive'
        ? probabilities.pos
        : label === 'negative'
          ? probabilities.neg
          : probabilities.neu;

    return {
      label,
      confidence,
      probabilities,
      model: response?.model ?? DEFAULT_SENTIMENT_MODEL,
    };
  }
}

/**
 * Accepts both `POS/NEU/NEG` and the contract's `positive/neutral/negative`;
 * anything else is a broken contract, never a silent neutral.
 */
function normalizeLabel(label: unknown): SentimentLabel | null {
  switch (typeof label === 'string' ? label.toUpperCase() : '') {
    case 'POS':
    case 'POSITIVE':
      return 'positive';
    case 'NEG':
    case 'NEGATIVE':
      return 'negative';
    case 'NEU':
    case 'NEUTRAL':
      return 'neutral';
    default:
      return null;
  }
}

function readProbabilities(value: unknown): SentimentProbabilities | null {
  if (typeof value !== 'object' || value === null) return null;

  const { POS, NEU, NEG } = value as Record<string, unknown>;
  if (![POS, NEU, NEG].every(isFiniteNumber)) return null;

  return { pos: POS as number, neu: NEU as number, neg: NEG as number };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Highest average wins; ties resolve POS > NEG > NEU so the indicator is
 * deterministic, and an empty conversation stays neutral.
 */
function dominantTone(
  aggregate: ConversationSentimentAggregate,
): ConversationSentiment['dominant'] {
  if (aggregate.totalMessages === 0) return 'NEU';

  if (
    aggregate.avgPos >= aggregate.avgNeu &&
    aggregate.avgPos >= aggregate.avgNeg
  ) {
    return 'POS';
  }

  return aggregate.avgNeg >= aggregate.avgNeu ? 'NEG' : 'NEU';
}
