// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ChannelType } from '@contracts';

/** What a provider reported about one outbound message's cost. */
export interface ChargeReport {
  /** Channel-specific category (WhatsApp: marketing, utility, service…). */
  category: string;
  billable: boolean;
  pricingModel: string | null;
}

/**
 * How one provider prices outbound messages. The spend module only talks to
 * this port: adding Telegram (free) is an adapter whose `extractCharge`
 * returns null and `isBillableSend` false, nothing else changes.
 */
export interface ChannelPricing {
  readonly type: ChannelType;

  /** Categories that can carry a price, in display order. */
  categories(): readonly string[];

  /** Approximate USD per billable unit, used until the company edits them. */
  defaultRates(): Readonly<Record<string, number>>;

  /** Reads the raw cost report of a status callback; null = nothing to record. */
  extractCharge(report: unknown): ChargeReport | null;

  /** Whether sending this kind of message is billable up front. */
  isBillableSend(input: { messageType: string }): boolean;
}
