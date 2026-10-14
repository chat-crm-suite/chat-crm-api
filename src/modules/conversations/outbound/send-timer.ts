// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

type Phase = 'saved' | 'uploaded' | 'delivered';

/** Milliseconds per phase of one send; `null` when the phase did not run. */
export interface SendTiming {
  /** Gateway → worker pick-up (Redis + queue wait). */
  queueMs: number | null;
  /** Row persisted (and broadcast) as pending. */
  saveMs: number | null;
  /** File handed to the provider (media only, first attempt). */
  uploadMs: number | null;
  /** Provider answered the send. */
  providerMs: number | null;
  /** Gateway (or worker) start → end of the run. */
  totalMs: number;
}

/**
 * Measures where a send spends its time, so latency is judged on numbers
 * (`send.timing` log lines correlated by `clientMessageId`), not guesses.
 */
export class SendTimer {
  private readonly startedAt: number;
  private readonly marks: Partial<Record<Phase, number>> = {};

  constructor(
    private readonly receivedAt?: number,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  mark(phase: Phase): void {
    this.marks[phase] = this.now();
  }

  summary(): SendTiming {
    const { saved, uploaded, delivered } = this.marks;
    const since = (from?: number, to?: number) =>
      from !== undefined && to !== undefined ? to - from : null;

    return {
      queueMs: since(this.receivedAt, this.startedAt),
      saveMs: since(this.startedAt, saved),
      uploadMs: since(saved, uploaded),
      providerMs: since(uploaded ?? saved, delivered),
      totalMs: this.now() - (this.receivedAt ?? this.startedAt),
    };
  }
}
