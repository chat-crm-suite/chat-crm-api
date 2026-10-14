// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ChannelAdapter } from './channel-adapter.port';
import { ChannelAdapterRegistry } from './channel-adapter.registry';

const adapter = (type: ChannelAdapter['type']): ChannelAdapter => ({
  type,
  send: jest.fn(),
  uploadMedia: jest.fn(),
});

describe('ChannelAdapterRegistry', () => {
  it('returns the adapter registered for a channel type', () => {
    const registry = new ChannelAdapterRegistry();
    const whatsapp = adapter('whatsapp');

    registry.register(whatsapp);

    expect(registry.for('whatsapp')).toBe(whatsapp);
    expect(registry.for('telegram')).toBeNull();
  });

  it('refuses a second adapter for the same channel type', () => {
    const registry = new ChannelAdapterRegistry();
    registry.register(adapter('whatsapp'));

    expect(() => registry.register(adapter('whatsapp'))).toThrow(
      'A whatsapp channel adapter is already registered',
    );
  });
});
