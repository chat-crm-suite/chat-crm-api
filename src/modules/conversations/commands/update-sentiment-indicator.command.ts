import { Command } from '@nestjs/cqrs';

export class UpdateSentimentIndicatorCommand extends Command<{
  conversationId?: string;
}> {
  constructor(
    public readonly probabilities: {
      pos: number;
      neu: number;
      neg: number;
    },
    public readonly conversationId?: string,
  ) {
    super();
  }
}
