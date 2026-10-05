import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { EventBus } from '@nestjs/cqrs';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { MessageAnalyzedEvent } from '../events/message-analyzed.event';
import { SENTIMENT_QUEUE } from './sentiment.constants';
import { SentimentService } from './sentiment.service';
import type { SentimentAnalysisResult, SentimentPayload } from './sentiment.type';

type SentimentJob = Job<SentimentPayload>;

@Processor(SENTIMENT_QUEUE)
export class SentimentProcessor extends WorkerHost {
  constructor(
    private readonly service: SentimentService,
    private readonly logger: PinoLogger,
    private readonly event: EventBus,
  ) {
    super();
    this.logger.setContext(SentimentProcessor.name);
  }

  process(job: SentimentJob) {
    return this.service.analyzeMessage(job.data);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: SentimentJob, result: SentimentAnalysisResult | null) {
    if (!result) {
      this.logger.warn(
        { jobId: job.id, messageId: job.data.messageId },
        'Sentiment analysis produced no result',
      );
      return;
    }

    this.event.publish(
      new MessageAnalyzedEvent(
        result.messageId,
        result.analysisId,
        result.probabilities,
        result.label,
        result.conversationId,
      ),
    );

    this.logger.debug(
      {
        analysisId: result.analysisId,
        messageId: result.messageId,
        conversationId: result.conversationId,
      },
      'Calculated Sentiment in message',
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: SentimentJob, error: Error) {
    this.logger.error(
      { err: error, jobId: job.id },
      `Job ${job.id} failed: ${error.message}`,
    );
  }
}
