// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ChannelPricingRegistry } from '@modules/channels/ports/channel-pricing.registry';
import { WhatsAppPricingAdapter } from './whatsapp-pricing.adapter';

describe('WhatsAppPricingAdapter', () => {
  const registry = new ChannelPricingRegistry();
  const adapter = new WhatsAppPricingAdapter(registry);
  adapter.onModuleInit();

  it('registers itself for whatsapp channels', () => {
    expect(registry.for('whatsapp')).toBe(adapter);
    expect(registry.for('telegram')).toBeNull();
  });

  it('reads per-message pricing (type decides billability)', () => {
    expect(
      adapter.extractCharge({
        billable: true,
        pricing_model: 'PMP',
        category: 'marketing',
        type: 'regular',
      }),
    ).toEqual({ category: 'marketing', billable: true, pricingModel: 'PMP' });

    expect(
      adapter.extractCharge({
        billable: false,
        pricing_model: 'PMP',
        category: 'utility',
        type: 'free_customer_service',
      })?.billable,
    ).toBe(false);
  });

  it('treats service replies as free under the legacy flag', () => {
    expect(
      adapter.extractCharge({ billable: true, pricing_model: 'CBP', category: 'service' })
        ?.billable,
    ).toBe(false);
  });

  it('ignores missing or malformed reports', () => {
    expect(adapter.extractCharge(undefined)).toBeNull();
    expect(adapter.extractCharge({ billable: true })).toBeNull();
    expect(adapter.extractCharge('PMP')).toBeNull();
  });

  it('only charges template sends up front', () => {
    expect(adapter.isBillableSend({ messageType: 'template' })).toBe(true);
    expect(adapter.isBillableSend({ messageType: 'text' })).toBe(false);
  });
});
