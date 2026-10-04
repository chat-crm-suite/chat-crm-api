import { InjectQueue } from '@nestjs/bullmq';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Queue } from 'bullmq';

import { AnalyzeMessageCommand } from '../analyze-message.command';
import { SENTIMENT_JOB, SENTIMENT_QUEUE } from '../../sentiment.constants';
import type { SentimentPayload } from '../../sentiment.type';

@CommandHandler(AnalyzeMessageCommand)
export class AnalyseMessageHandler
  implements ICommandHandler<AnalyzeMessageCommand, { jobId?: string }>
{
  constructor(
    @InjectQueue(SENTIMENT_QUEUE)
    private readonly queue: Queue<SentimentPayload>,
  ) {}

  async execute(command: AnalyzeMessageCommand): Promise<{ jobId?: string }> {
    const job = await this.queue.add(SENTIMENT_JOB, {
      messageId: command.messageId,
      content: command.content ?? null,
      conversationId: command.conversationId,
    });

    return { jobId: job.id };
  }
}
