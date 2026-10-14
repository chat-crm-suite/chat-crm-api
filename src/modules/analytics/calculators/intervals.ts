// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/** Half-open time span `[start, end)` in ms. */
export interface Span {
  start: number;
  end: number;
}

/** Clips spans to `[from, to)` and drops the empty ones. */
export function clip(spans: readonly Span[], from: number, to: number): Span[] {
  return spans
    .map((span) => ({ start: Math.max(span.start, from), end: Math.min(span.end, to) }))
    .filter((span) => span.end > span.start);
}

/** Sorted, non-overlapping union of spans. */
export function union(spans: readonly Span[]): Span[] {
  const sorted = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** Total length of the union, in seconds. */
export function totalSeconds(spans: readonly Span[]): number {
  return union(spans).reduce((sum, span) => sum + (span.end - span.start), 0) / 1000;
}

/** Overlap (seconds) between the unions of two span sets. */
export function overlapSeconds(a: readonly Span[], b: readonly Span[]): number {
  const left = union(a);
  const right = union(b);
  let i = 0;
  let j = 0;
  let total = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i].start, right[j].start);
    const end = Math.min(left[i].end, right[j].end);
    if (end > start) total += end - start;
    if (left[i].end < right[j].end) i++;
    else j++;
  }
  return total / 1000;
}
