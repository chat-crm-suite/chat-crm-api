// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/** Normalized probabilities used by the event, entities and client mapping. */
export type SentimentProbabilities = {
  pos: number;
  neu: number;
  neg: number;
};

/** BullMQ payload for the `sentiment` queue. */
export type SentimentPayload = {
  messageId: string;
  content?: string | null;
  conversationId?: string;
};

/** Type-specific JSON persisted in `analyses.result`. */
export type SentimentResultPayload = {
  probabilities: SentimentProbabilities;
};

/** Job result; also the source for `MessageAnalyzedEvent`. */
export type SentimentAnalysisResult = {
  messageId: string;
  analysisId: string;
  probabilities: SentimentProbabilities;
  label: string;
  conversationId: string;
};
