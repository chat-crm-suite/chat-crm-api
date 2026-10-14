// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';

import type { ChannelType } from '@contracts';
import type { ChannelAdapter } from './channel-adapter.port';

/**
 * Adapters register themselves from their own module (`onModuleInit`), so
 * the channel-agnostic pipeline depends only on this registry and the module
 * graph stays acyclic: adding Telegram is a new module that registers its
 * adapter, nothing else changes.
 */
@Injectable()
export class ChannelAdapterRegistry {
  private readonly adapters = new Map<ChannelType, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.type)) {
      throw new Error(`A ${adapter.type} channel adapter is already registered`);
    }
    this.adapters.set(adapter.type, adapter);
  }

  /** The adapter for a channel type, or `null` when none is installed. */
  for(type: ChannelType): ChannelAdapter | null {
    return this.adapters.get(type) ?? null;
  }
}
