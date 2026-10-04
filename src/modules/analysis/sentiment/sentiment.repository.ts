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
}
