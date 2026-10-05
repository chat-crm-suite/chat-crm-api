/**
 * Published after a message sentiment analysis has been persisted.
 * `analysisId` is the `analyses.id` and `conversationId` replaces the old
 * `chatId` (v2 vocabulary).
 */
export class MessageAnalyzedEvent {
  constructor(
    public readonly messageId: string,
    public readonly analysisId: string,
    public readonly probabilities: { pos: number; neu: number; neg: number },
    public readonly label?: string,
    public readonly conversationId?: string,
  ) {}
}
