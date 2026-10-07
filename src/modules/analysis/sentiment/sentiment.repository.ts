// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import type {
  AnalysisSkipReason,
  ConversationSentiment,
  SentimentLabel,
} from '../../../contracts/index';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Message } from '../../message/entities/message.entity';
import { AnalysisType } from '../analysis.enum';
import { Analysis } from '../entities/analysis.entity';
import { SentimentResult } from '../entities/sentiment-result.entity';
import {
  isRetryableSkipReason,
  MAX_RETRY_ATTEMPTS,
  RETRYABLE_SKIP_REASONS,
  retryDelayMs,
} from './sentiment-retry.policy';
import type {
  SentimentProbabilities,
  SentimentResultPayload,
} from './sentiment.type';

export type CreateAnalysisInput = {
  companyId: string;
  messageId: string;
  conversationId: string;
  model: string;
};

export type CompleteAnalysisInput = {
  label: SentimentLabel;
  confidence: number;
  model: string;
  probabilities: SentimentProbabilities;
  result: SentimentResultPayload;
};

/**
 * Averages + analyzed count over the completed analyses of a conversation.
 * Mirrors the shared contract minus the derived `dominant` tone.
 */
export type ConversationSentimentAggregate = Omit<
  ConversationSentiment,
  'dominant'
>;

/**
 * Persistence for the v2 `analyses` header + its 1:1 `sentiment_results`
 * detail, plus message lookups needed by the processor.
 */
@Injectable()
export class SentimentRepository {
  constructor(
    @InjectRepository(Analysis)
    private readonly analyses: Repository<Analysis>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    private readonly dataSource: DataSource,
  ) {}

  findMessage(messageId: string): Promise<Message | null> {
    return this.messages.findOne({ where: { id: messageId } });
  }

  /** Creates the `analyses` header first so a later failure can be recorded. */
  createProcessing(input: CreateAnalysisInput): Promise<Analysis> {
    const analysis = this.analyses.create({
      companyId: input.companyId,
      target: 'message',
      messageId: input.messageId,
      conversationId: input.conversationId,
      type: AnalysisType.SENTIMENT,
      model: input.model,
      status: 'processing',
    });

    return this.analyses.save(analysis);
  }

  /** Marks the header completed and inserts its 1:1 sentiment detail. */
  async complete(analysisId: string, input: CompleteAnalysisInput): Promise<Analysis> {
    return this.dataSource.transaction(async (manager) => {
      const analysis = await manager.findOneOrFail(Analysis, {
        where: { id: analysisId },
      });

      analysis.status = 'completed';
      analysis.label = input.label;
      analysis.confidence = input.confidence;
      analysis.model = input.model;
      analysis.result = input.result;
      analysis.completedAt = new Date();

      const saved = await manager.save(analysis);

      await manager.save(
        manager.create(SentimentResult, {
          analysisId,
          label: input.label,
          scorePositive: input.probabilities.pos,
          scoreNeutral: input.probabilities.neu,
          scoreNegative: input.probabilities.neg,
        }),
      );

      return saved;
    });
  }

  async markFailed(analysisId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);

    await this.analyses.update(analysisId, {
      status: 'failed',
      error: message.slice(0, 500),
    });
  }

  /**
   * T1: terminal availability skip. The header keeps the reason; no
   * `sentiment_results` detail is written, so a skipped analysis can never
   * masquerade as an analyzed neutral one. T4: a retryable skip also schedules
   * the next deferred attempt from the persisted `retryCount` (5m → 24h, then
   * it gives up and `nextRetryAt` stays null).
   */
  async markSkipped(
    analysisId: string,
    reason: AnalysisSkipReason,
  ): Promise<void> {
    await this.analyses.update(analysisId, {
      status: 'skipped',
      skipReason: reason,
      nextRetryAt: await this.nextRetryAtFor(analysisId, reason),
    });
  }

  /** T4: when the retry after the stored attempts is due; null when never. */
  private async nextRetryAtFor(
    analysisId: string,
    reason: AnalysisSkipReason,
  ): Promise<Date | null> {
    if (!isRetryableSkipReason(reason)) return null;

    const analysis = await this.analyses.findOne({
      where: { id: analysisId },
      select: { id: true, retryCount: true },
    });
    const delay = retryDelayMs((analysis?.retryCount ?? 0) + 1);

    return delay === null ? null : new Date(Date.now() + delay);
  }

  /**
   * T4: due deferred retries for the worker. Only sentiment skips caused by
   * real unavailability are candidates; manual skips, hard failures and rows
   * that exhausted the 8 attempts never are. Oldest due first, bounded so one
   * scan can never flood the queue.
   */
  findDueRetries(limit: number, now: Date): Promise<Analysis[]> {
    return this.analyses
      .createQueryBuilder('analysis')
      .where('analysis.status = :status', { status: 'skipped' })
      .andWhere('analysis.type = :type', { type: AnalysisType.SENTIMENT })
      .andWhere('analysis.skipReason IN (:...reasons)', {
        reasons: RETRYABLE_SKIP_REASONS,
      })
      .andWhere('analysis.nextRetryAt IS NOT NULL')
      .andWhere('analysis.nextRetryAt <= :now', { now })
      .andWhere('analysis.retryCount < :maxAttempts', {
        maxAttempts: MAX_RETRY_ATTEMPTS,
      })
      .orderBy('analysis.nextRetryAt', 'ASC')
      .take(limit)
      .getMany();
  }

  /**
   * T4: moves a due skip to its next attempt — increments `retryCount` and
   * pre-schedules the following wait (`null` once the enqueued attempt was the
   * last). The update is a compare-and-set on the scanned attempt count and
   * status, so two concurrent scans can never consume the same attempt twice.
   */
  async scheduleRetryAttempt(
    analysisId: string,
    expectedRetryCount: number,
    nextRetryAt: Date | null,
  ): Promise<boolean> {
    const result = await this.analyses.update(
      { id: analysisId, status: 'skipped', retryCount: expectedRetryCount },
      { retryCount: expectedRetryCount + 1, nextRetryAt },
    );

    return (result.affected ?? 0) > 0;
  }

  /**
   * T4: flips a skipped row back to `processing` for a retry attempt, clearing
   * the skip reason. Returns null when the row is no longer skipped, so two
   * retry jobs for the same analysis can never process it twice.
   */
  async startRetry(analysisId: string): Promise<Analysis | null> {
    const result = await this.analyses.update(
      { id: analysisId, status: 'skipped' },
      { status: 'processing', skipReason: null },
    );
    if ((result.affected ?? 0) === 0) return null;

    return this.analyses.findOneBy({ id: analysisId });
  }

  /**
   * T4: `GET /conversations/:id/sentiment` source. Averages the probabilities
   * of the conversation's completed sentiment analyses and counts them, scoped
   * to the caller's company so a foreign id can never leak another tenant's
   * tone. MySQL returns AVG/COUNT as strings, so every value is normalized to a
   * number; a conversation without analyses yields zeros.
   */
  async aggregateConversationSentiment(
    conversationId: string,
    companyId: string,
  ): Promise<ConversationSentimentAggregate> {
    const row = await this.analyses
      .createQueryBuilder('analysis')
      .innerJoin(
        SentimentResult,
        'sentiment',
        'sentiment.analysis_id = analysis.id',
      )
      .select('AVG(sentiment.score_positive)', 'avgPos')
      .addSelect('AVG(sentiment.score_neutral)', 'avgNeu')
      .addSelect('AVG(sentiment.score_negative)', 'avgNeg')
      .addSelect('COUNT(sentiment.analysis_id)', 'totalMessages')
      .where('analysis.conversation_id = :conversationId', { conversationId })
      .andWhere('analysis.company_id = :companyId', { companyId })
      .andWhere('analysis.status = :status', { status: 'completed' })
      .getRawOne<Record<string, unknown>>();

    return {
      avgPos: toNumber(row?.avgPos),
      avgNeu: toNumber(row?.avgNeu),
      avgNeg: toNumber(row?.avgNeg),
      totalMessages: Math.trunc(toNumber(row?.totalMessages)),
    };
  }

  /**
   * Tenant guard for the sentiment read: the conversation must exist and
   * belong to the caller's company. Unknown ids and foreign conversations both
   * resolve to `false`, so the caller can answer 404 instead of neutral zeros.
   */
  async conversationBelongsToCompany(
    conversationId: string,
    companyId: string,
  ): Promise<boolean> {
    const conversation = await this.dataSource
      .getRepository(Conversation)
      .findOne({
        where: { id: conversationId, companyId },
        select: { id: true },
      });

    return conversation !== null;
  }
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}
