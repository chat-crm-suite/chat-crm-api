import { z } from 'zod';

/**
 * AI analysis contracts (v2): `analyses` header + 1:1 detail tables.
 * `analyses.type` stays varchar: new analysis types need no migration.
 */
export const ANALYSIS_TARGETS = ['message', 'conversation'] as const;
export const AnalysisTargetSchema = z.enum(ANALYSIS_TARGETS);
export type AnalysisTarget = z.infer<typeof AnalysisTargetSchema>;

export const ANALYSIS_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const;
export const AnalysisStatusSchema = z.enum(ANALYSIS_STATUSES);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const SENTIMENT_LABELS = ['positive', 'neutral', 'negative'] as const;
export const SentimentLabelSchema = z.enum(SENTIMENT_LABELS);
export type SentimentLabel = z.infer<typeof SentimentLabelSchema>;
