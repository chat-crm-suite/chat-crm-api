// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

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
  'skipped',
] as const;
export const AnalysisStatusSchema = z.enum(ANALYSIS_STATUSES);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

/** Why an analysis was not processed because the IA was unavailable. */
export const ANALYSIS_SKIP_REASONS = [
  'kill_switch',
  'circuit_breaker',
  'ia_unavailable',
] as const;
export const AnalysisSkipReasonSchema = z.enum(ANALYSIS_SKIP_REASONS);
export type AnalysisSkipReason = z.infer<typeof AnalysisSkipReasonSchema>;

/**
 * Read shape of the `analyses` resource: `status` plus the optional
 * `skipReason` let consumers tell an analysis skipped because the IA was
 * unavailable apart from one actually analyzed as neutral.
 */
export const AnalysisResourceSchema = z.object({
  id: z.string(),
  target: AnalysisTargetSchema,
  type: z.string(),
  messageId: z.string().nullish(),
  conversationId: z.string(),
  status: AnalysisStatusSchema,
  skipReason: AnalysisSkipReasonSchema.nullish(),
  label: z.string().nullish(),
  confidence: z.number().nullish(),
  model: z.string().nullish(),
  error: z.string().nullish(),
  createdAt: z.coerce.date(),
  completedAt: z.coerce.date().nullish(),
});
export type AnalysisResource = z.infer<typeof AnalysisResourceSchema>;

export const SENTIMENT_LABELS = ['positive', 'neutral', 'negative'] as const;
export const SentimentLabelSchema = z.enum(SENTIMENT_LABELS);
export type SentimentLabel = z.infer<typeof SentimentLabelSchema>;
