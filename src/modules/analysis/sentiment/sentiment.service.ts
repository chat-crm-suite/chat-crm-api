// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type {
  AnalysisSkipReason,
  ConversationSentiment,
  SentimentLabel,
} from '../../../contracts/index';
import { CircuitBreakerService } from '../ia/circuit-breaker.service';
import { KillSwitchService } from '../ia/kill-switch.service';
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

/** T5: every skip is an expected condition and logs at info level. */
const SKIP_MESSAGES: Record<AnalysisSkipReason, string> = {
  kill_switch: 'Sentiment analysis skipped: kill switch off',
  circuit_breaker: 'Sentiment analysis skipped: circuit breaker open',
  ia_unavailable: 'Sentiment analysis skipped: IA unavailable',
};

/**
 * Sentiment analysis orchestration: loads the message for company/conversation
 * context (and body fallback), calls the FastAPI client and persists the
 * `analyses` + `sentiment_results` rows. Never throws: IA unavailability marks
 * the analysis `skipped` (reason `ia_unavailable`) and returns null; broken
 * responses or real failures mark it `failed` and also return null. The
 * decision pipeline is kill switch → circuit breaker → IA call: a manual
 * disable skips as `kill_switch` and an open breaker skips as
 * `circuit_breaker`, both before any IA call.
 */
@Injectable()
export class SentimentService {
  constructor(
    private readonly repo: SentimentRepository,
    private readonly client: SentimentClient,
    private readonly logger: PinoLogger,
    private readonly killSwitch: KillSwitchService,
    private readonly breaker: CircuitBreakerService,
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

    // T4: a deferred retry carries its analysisId and reuses that row; only a
    // fresh analysis creates a new one.
    const analysis = await (
      payload.analysisId
        ? this.repo.startRetry(payload.analysisId)
        : this.repo.createProcessing({
            companyId,
            messageId: payload.messageId,
            conversationId,
            model: DEFAULT_SENTIMENT_MODEL,
          })
    ).catch((error: unknown) => {
      this.logger.error(
        { err: error, messageId: payload.messageId, conversationId },
        'Failed to create sentiment analysis',
      );
      return null;
    });
    if (!analysis) return null;

    const analysisId = analysis.id;

    // T2/T3: decision pipeline — kill switch → circuit breaker → IA call.
    // Both short-circuits still record the analysis as skipped, so omissions
    // stay visible.
    if (!(await this.killSwitch.isEnabled())) {
      await this.markSkipped(
        analysisId,
        payload,
        conversationId,
        'kill_switch',
      );
      return null;
    }

    if (!(await this.breaker.beforeCall())) {
      await this.markSkipped(
        analysisId,
        payload,
        conversationId,
        'circuit_breaker',
      );
      return null;
    }

    const response = await this.client
      .analyze(content)
      .catch(async (error: unknown) => {
        if (isIaUnavailable(error)) {
          // T3: transport failures and 5xx feed the breaker; the analysis is
          // skipped as retryable unavailability.
          await this.breaker.recordFailure();
          await this.markSkipped(
            analysisId,
            payload,
            conversationId,
            'ia_unavailable',
          );
        } else {
          await this.markFailed(analysisId, error, payload, conversationId);
        }

        return null;
      });
    if (response === null) return null;

    try {
      const mapped = this.mapResponse(response);

      // T3: only a valid IA response counts as success for the breaker; a
      // broken contract never alters its state.
      await this.breaker.recordSuccess();

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

  /** T1/T2: expected unavailability → `skipped` + info log, never an error. */
  private async markSkipped(
    analysisId: string,
    payload: SentimentPayload,
    conversationId: string,
    reason: AnalysisSkipReason,
  ): Promise<void> {
    await this.repo
      .markSkipped(analysisId, reason)
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
        reason,
      },
      SKIP_MESSAGES[reason],
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
