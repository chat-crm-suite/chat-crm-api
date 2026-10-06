// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { PeriodTime } from '../../../lib/period';
import { CompareMetric, Table } from '../metrics.types';
import { SentimentLabel } from '../../analysis/sentiment/sentiment.enum';

export const SENTIMENT_LABELS_MAP = {
  positive: SentimentLabel.POSITIVE,
  neutral: SentimentLabel.NEUTRAL,
  negative: SentimentLabel.NEGATIVE,
} as const;

/**
 * Schema v2 targets for the compare endpoint.
 * - chat: conversations
 * - transfer: conversation_assignments (transfers are rows with reason='transfer')
 * - agent/client: distinct senders of outbound/inbound messages
 */
export const COMPARE_PERIOD_CONFIG: Record<
  CompareMetric,
  { target: Table; column: string; where?: string; timeColumn?: string }
> = {
  chat: {
    column: 'id',
    target: 'conversations',
  },
  message: {
    column: 'id',
    target: 'messages',
  },
  transfer: {
    column: 'id',
    target: 'conversation_assignments',
    timeColumn: 'assigned_at',
    where: "reason = 'transfer'",
  },
  agent: {
    target: 'messages',
    column: 'sender_member_id',
    where: "direction = 'outbound'",
  },
  client: {
    target: 'messages',
    column: 'sender_customer_id',
    where: "direction = 'inbound'",
  },
} as const;

// Date format strings for SQL DATE_FORMAT function based on period time
export const DATE_FORMAT_SQL: Record<PeriodTime, string> = {
  // date: 'date subdate' -- format
  hour: '%H %i',
  day: '%W %H',
  week: '%u %W',
  month: '%b %d',
  year: '%Y %M',
} as const;
