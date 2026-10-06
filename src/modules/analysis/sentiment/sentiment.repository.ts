// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import type { SentimentLabel } from '../../../contracts/index';
import { Message } from '../../message/entities/message.entity';
import { AnalysisType } from '../analysis.enum';
import { Analysis } from '../entities/analysis.entity';
import { SentimentResult } from '../entities/sentiment-result.entity';
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

/** Averages + analyzed count over the completed analyses of a conversation. */
export type ConversationSentimentAggregate = {
  avgPos: number;
  avgNeu: number;
  avgNeg: number;
  totalMessages: number;
};

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
   * T4: `GET /conversations/:id/sentiment` source. Averages the probabilities
   * of the conversation's completed sentiment analyses and counts them. MySQL
   * returns AVG/COUNT as strings, so every value is normalized to a number;
   * a conversation without analyses yields zeros.
   */
  async aggregateConversationSentiment(
    conversationId: string,
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
      .andWhere('analysis.status = :status', { status: 'completed' })
      .getRawOne<Record<string, unknown>>();

    return {
      avgPos: toNumber(row?.avgPos),
      avgNeu: toNumber(row?.avgNeu),
      avgNeg: toNumber(row?.avgNeg),
      totalMessages: Math.trunc(toNumber(row?.totalMessages)),
    };
  }
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}
