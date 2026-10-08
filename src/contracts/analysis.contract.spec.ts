// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ANALYSIS_SKIP_REASONS,
  ANALYSIS_STATUSES,
  AnalysisResourceSchema,
  AnalysisSkipReasonSchema,
  AnalysisStatusSchema,
} from './analysis.contract';

/**
 * T1: the analysis read contract exposes `status` and `skipReason`, the two
 * fields consumers need to tell a skipped analysis apart from an analyzed
 * neutral one.
 */
describe('analysis contract (T1)', () => {
  it('includes skipped among the analysis statuses', () => {
    expect(ANALYSIS_STATUSES).toContain('skipped');
    expect(AnalysisStatusSchema.safeParse('skipped').success).toBe(true);
  });

  it('knows the three availability skip reasons', () => {
    expect(ANALYSIS_SKIP_REASONS).toEqual([
      'kill_switch',
      'circuit_breaker',
      'ia_unavailable',
    ]);
    for (const reason of ANALYSIS_SKIP_REASONS) {
      expect(AnalysisSkipReasonSchema.safeParse(reason).success).toBe(true);
    }
    expect(AnalysisSkipReasonSchema.safeParse('nope').success).toBe(false);
  });

  it('parses a skipped analysis exposing status and skipReason', () => {
    const parsed = AnalysisResourceSchema.parse({
      id: 'analysis-1',
      target: 'message',
      type: 'sentiment',
      messageId: 'message-1',
      conversationId: 'conversation-1',
      status: 'skipped',
      skipReason: 'ia_unavailable',
      createdAt: '2026-10-07T12:00:00.000Z',
    });

    expect(parsed.status).toBe('skipped');
    expect(parsed.skipReason).toBe('ia_unavailable');
    expect(parsed.createdAt).toBeInstanceOf(Date);
  });

  it('parses an analyzed neutral without a skip reason', () => {
    const parsed = AnalysisResourceSchema.parse({
      id: 'analysis-2',
      target: 'message',
      type: 'sentiment',
      conversationId: 'conversation-1',
      status: 'completed',
      label: 'neutral',
      createdAt: '2026-10-07T12:00:00.000Z',
    });

    expect(parsed.status).toBe('completed');
    expect(parsed.skipReason).toBeUndefined();
  });
});
