// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { faker } from '@faker-js/faker';
import { Factory } from 'fishery';

import { Analysis } from '@modules/analysis/entities/analysis.entity';
import { SentimentResult } from '@modules/analysis/entities/sentiment-result.entity';
import type { SentimentLabel } from '../../src/contracts/index';

import { AnalysisFactory } from './analysis.factory';
import type { ManagerTransientParams } from './types';

type SentimentResultTransientParams = ManagerTransientParams;

export const SentimentResultFactory = Factory.define<
  SentimentResult,
  SentimentResultTransientParams
>(({ associations, onCreate, params, transientParams }) => {
  onCreate(async (sentiment) => {
    const manager = transientParams.manager;
    if (!manager) return sentiment;

    if (sentiment.analysis && !sentiment.analysis.id) {
      sentiment.analysis = await AnalysisFactory.transient({ manager }).create(
        sentiment.analysis,
      );
    }
    sentiment.analysisId = sentiment.analysis.id;

    return manager.getRepository(SentimentResult).save(sentiment);
  });

  const scores = generateNormalizedScores();
  const sentiment = new SentimentResult();
  const label = params.label ?? determineLabelFromScores(scores);
  sentiment.label = label;
  sentiment.scorePositive =
    params.scorePositive ?? (label === 'positive' ? 1 : scores.pos);
  sentiment.scoreNeutral =
    params.scoreNeutral ?? (label === 'neutral' ? 1 : scores.neu);
  sentiment.scoreNegative =
    params.scoreNegative ?? (label === 'negative' ? 1 : scores.neg);

  const analysis =
    associations.analysis ??
    (params.analysisId
      ? ({ id: params.analysisId } as Analysis)
      : AnalysisFactory.build());
  sentiment.analysis = analysis;
  sentiment.analysisId = analysis.id;

  return sentiment;
});

/** Normalized scores that add up to 1. */
function generateNormalizedScores() {
  const pos = parseFloat(
    faker.number.float({ min: 0, max: 1, fractionDigits: 4 }).toFixed(4),
  );
  const neu = parseFloat(
    faker.number.float({ min: 0, max: 1 - pos, fractionDigits: 4 }).toFixed(4),
  );
  const neg = parseFloat((1 - pos - neu).toFixed(4));

  return { pos, neu, neg };
}

function determineLabelFromScores(scores: {
  pos: number;
  neu: number;
  neg: number;
}): SentimentLabel {
  const max = Math.max(scores.pos, scores.neu, scores.neg);

  if (max === scores.pos) return 'positive';
  if (max === scores.neg) return 'negative';
  return 'neutral';
}
