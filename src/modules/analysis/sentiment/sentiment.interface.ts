// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { SentimentLabel } from './sentiment.enum';

export interface SentimentResponse {
  text: string;
  label: SentimentLabel;
  probabilities: Record<SentimentLabel, number>;
  /** Model reported by the service; falls back to `pysentiment` when absent. */
  model?: string;
}
