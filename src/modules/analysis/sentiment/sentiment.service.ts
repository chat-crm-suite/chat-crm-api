import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { SentimentLabel } from '../../../contracts/index';
import { SentimentClient } from './sentiment.client';
import { DEFAULT_SENTIMENT_MODEL } from './sentiment.constants';
import type { SentimentResponse } from './sentiment.interface';
import { SentimentRepository } from './sentiment.repository';
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
 * `analyses` + `sentiment_results` rows. Never throws: failures mark the
 * analysis as failed and return null.
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

    let analysisId: string | undefined;

    try {
      const analysis = await this.repo.createProcessing({
        companyId,
        messageId: payload.messageId,
        conversationId,
        model: DEFAULT_SENTIMENT_MODEL,
      });
      analysisId = analysis.id;

      const response = await this.client.analyze(content);
      const mapped = this.mapResponse(response);

      await this.repo.complete(analysis.id, {
        label: mapped.label,
        confidence: mapped.confidence,
        model: mapped.model,
        probabilities: mapped.probabilities,
        result: { probabilities: mapped.probabilities },
      });

      return {
        messageId: payload.messageId,
        analysisId: analysis.id,
        probabilities: mapped.probabilities,
        label: mapped.label,
        conversationId,
      };
    } catch (error) {
      if (analysisId) {
        await this.repo
          .markFailed(analysisId, error)
          .catch((markError) =>
            this.logger.error(
              { err: markError, analysisId },
              'Failed to mark sentiment analysis as failed',
            ),
          );
      }

      this.logger.error(
        { err: error, messageId: payload.messageId, conversationId },
        'Sentiment analysis failed',
      );

      return null;
    }
  }

  private mapResponse(response: SentimentResponse): MappedResponse {
    const probabilities: SentimentProbabilities = {
      pos: normalizeScore(response?.probabilities?.POS),
      neu: normalizeScore(response?.probabilities?.NEU),
      neg: normalizeScore(response?.probabilities?.NEG),
    };

    const label = normalizeLabel(response?.label);
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

function normalizeScore(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Accepts both `POS/NEU/NEG` and the contract's `positive/neutral/negative`. */
function normalizeLabel(label: unknown): SentimentLabel {
  switch (typeof label === 'string' ? label.toUpperCase() : '') {
    case 'POS':
    case 'POSITIVE':
      return 'positive';
    case 'NEG':
    case 'NEGATIVE':
      return 'negative';
    case 'NEU':
    case 'NEUTRAL':
    default:
      return 'neutral';
  }
}
