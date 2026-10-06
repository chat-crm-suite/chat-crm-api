// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

/**
 * Metrics query/param contracts. Query values arrive as strings, so numbers
 * are coerced and enums validated after normalization.
 */
export const METRICS_PERIODS = ['hour', 'day', 'week', 'month', 'year'] as const;
export const MetricsPeriodSchema = z.enum(METRICS_PERIODS);

export const METRIC_SENTIMENT_LABELS = ['POS', 'NEU', 'NEG'] as const;
export const MetricSentimentLabelSchema = z.enum(METRIC_SENTIMENT_LABELS);

/** Accepts both the short labels (`POS`) and the long names (`positive`). */
const NormalizedSentimentLabelSchema = z.preprocess((value) => {
  const normalized = typeof value === 'string' ? value.toLowerCase() : value;

  switch (normalized) {
    case 'positive':
      return 'POS';
    case 'neutral':
      return 'NEU';
    case 'negative':
      return 'NEG';
    default:
      return normalized;
  }
}, MetricSentimentLabelSchema);

export const SentimentTopQuerySchema = z.object({
  actor: z.enum(['agent', 'client']),
  type: NormalizedSentimentLabelSchema,
  limit: z.coerce.number().int().min(1).default(5),
});

export const SentimentTrendQuerySchema = z.object({
  period: MetricsPeriodSchema,
});

export const CompareQuerySchema = z.object({
  period: MetricsPeriodSchema,
});

export const CompareParamsSchema = z.object({
  metric: z
    .enum(['agent', 'chat', 'message', 'transfer', 'client'])
    .default('agent'),
});

export type MetricsPeriod = z.infer<typeof MetricsPeriodSchema>;
export type MetricSentimentLabel = z.infer<typeof MetricSentimentLabelSchema>;
export type SentimentTopQueryInput = z.infer<typeof SentimentTopQuerySchema>;
export type SentimentTrendQueryInput = z.infer<typeof SentimentTrendQuerySchema>;
export type CompareQueryInput = z.infer<typeof CompareQuerySchema>;
export type CompareParamsInput = z.infer<typeof CompareParamsSchema>;
