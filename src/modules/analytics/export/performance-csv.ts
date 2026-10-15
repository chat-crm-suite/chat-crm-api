// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { AgentsPerformance, RateEstimate } from '@contracts';

const HEADERS = [
  'member_id',
  'name',
  'role',
  'handled_cases',
  'resolved_cases',
  'connected_hours',
  'available_hours',
  'occupancy',
  'first_response_median_s',
  'first_response_p90_s',
  'reply_time_median_s',
  'resolution_time_median_s',
  'service_level',
  'service_level_low',
  'service_level_high',
  'service_level_adjusted',
  'reopen_rate',
  'reopen_rate_adjusted',
  'transfer_rate',
  'transfer_rate_adjusted',
  'negative_tone',
  'negative_tone_adjusted',
];

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  // RFC 4180 quoting; a leading formula character is neutralized for Excel.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const rate = (estimate: RateEstimate | null) => [
  estimate?.value ?? null,
  estimate?.adjusted ?? null,
];

/** One row per member; every rate keeps its raw and adjusted value. */
export function toPerformanceCsv(report: AgentsPerformance): string {
  const lines = [HEADERS.join(',')];

  for (const row of report.agents) {
    const [reopen, reopenAdjusted] = rate(row.reopenRate);
    const [transfer, transferAdjusted] = rate(row.transferRate);
    const [negative, negativeAdjusted] = rate(row.negativeTone);

    lines.push(
      [
        row.memberId,
        row.displayName,
        row.role,
        row.handledCases,
        row.resolvedCases,
        (row.connectedSeconds / 3600).toFixed(2),
        (row.availableSeconds / 3600).toFixed(2),
        row.occupancy,
        row.firstResponse.median,
        row.firstResponse.p90,
        row.replyTime.median,
        row.resolutionTime.median,
        row.serviceLevel.value,
        row.serviceLevel.interval?.low ?? null,
        row.serviceLevel.interval?.high ?? null,
        row.serviceLevel.adjusted,
        reopen,
        reopenAdjusted,
        transfer,
        transferAdjusted,
        negative,
        negativeAdjusted,
      ]
        .map(cell)
        .join(','),
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}
