// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, OnModuleInit } from '@nestjs/common';

import { WHATSAPP_CHARGE_CATEGORIES } from '@contracts';
import type {
  ChannelPricing,
  ChargeReport,
} from '@modules/channels/ports/channel-pricing.port';
import { ChannelPricingRegistry } from '@modules/channels/ports/channel-pricing.registry';

/**
 * Approximate USD per delivered template message. Meta prices by recipient
 * country; these are mid-range Latin America values meant as a starting
 * point — each company edits its own table (`PUT /billing/rates`).
 */
const DEFAULT_RATES: Record<string, number> = {
  marketing: 0.0625,
  utility: 0.008,
  authentication: 0.008,
  authentication_international: 0.028,
  service: 0,
};

/**
 * WhatsApp Cloud API pricing. Since 2025-07-01 Meta bills per delivered
 * template message; status webhooks carry
 * `pricing: { billable, pricing_model, category, type }` where `type` is
 * `regular` (charged) or `free_customer_service` / `free_entry_point`.
 * Free-form replies inside the 24 h window are `service` and free.
 */
@Injectable()
export class WhatsAppPricingAdapter implements ChannelPricing, OnModuleInit {
  readonly type = 'whatsapp' as const;

  constructor(private readonly registry: ChannelPricingRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  categories(): readonly string[] {
    return WHATSAPP_CHARGE_CATEGORIES;
  }

  defaultRates(): Readonly<Record<string, number>> {
    return DEFAULT_RATES;
  }

  extractCharge(report: unknown): ChargeReport | null {
    if (!report || typeof report !== 'object') return null;

    const pricing = report as {
      billable?: unknown;
      pricing_model?: unknown;
      category?: unknown;
      type?: unknown;
    };
    if (typeof pricing.category !== 'string' || !pricing.category) return null;

    const category = pricing.category.toLowerCase();
    // Per-message pricing states it explicitly; the legacy flag is the fallback.
    const billable =
      typeof pricing.type === 'string'
        ? pricing.type === 'regular'
        : pricing.billable === true && category !== 'service';

    return {
      category,
      billable,
      pricingModel:
        typeof pricing.pricing_model === 'string' ? pricing.pricing_model : null,
    };
  }

  /** Only template messages are charged; replies in the window are free. */
  isBillableSend({ messageType }: { messageType: string }): boolean {
    return messageType === 'template';
  }
}
