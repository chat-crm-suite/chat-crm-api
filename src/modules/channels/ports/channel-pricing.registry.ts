// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';

import type { ChannelType } from '@contracts';
import type { ChannelPricing } from './channel-pricing.port';

/**
 * Same pattern as `ChannelAdapterRegistry`: each provider module registers
 * its pricing adapter on init, so the spend module stays channel-agnostic.
 */
@Injectable()
export class ChannelPricingRegistry {
  private readonly pricings = new Map<ChannelType, ChannelPricing>();

  register(pricing: ChannelPricing): void {
    if (this.pricings.has(pricing.type)) {
      throw new Error(`A ${pricing.type} pricing adapter is already registered`);
    }
    this.pricings.set(pricing.type, pricing);
  }

  /** The pricing adapter for a channel type, or `null` (treated as free). */
  for(type: ChannelType): ChannelPricing | null {
    return this.pricings.get(type) ?? null;
  }
}
