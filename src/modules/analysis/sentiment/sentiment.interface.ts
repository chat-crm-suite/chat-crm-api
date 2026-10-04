import { SentimentLabel } from './sentiment.enum';

export interface SentimentResponse {
  text: string;
  label: SentimentLabel;
  probabilities: Record<SentimentLabel, number>;
  /** Model reported by the service; falls back to `pysentiment` when absent. */
  model?: string;
}
