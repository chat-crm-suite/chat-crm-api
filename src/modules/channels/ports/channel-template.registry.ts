// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';

import type { ChannelType } from '@contracts';
import type { TemplateProvider } from './channel-template.port';

/**
 * Same pattern as `ChannelAdapterRegistry`: each provider module registers
 * its template provider on init, so the templates module stays
 * channel-agnostic.
 */
@Injectable()
export class ChannelTemplateRegistry {
  private readonly providers = new Map<ChannelType, TemplateProvider>();

  register(provider: TemplateProvider): void {
    if (this.providers.has(provider.type)) {
      throw new Error(`A ${provider.type} template provider is already registered`);
    }
    this.providers.set(provider.type, provider);
  }

  /** The template provider for a channel type, or `null` (no templates). */
  for(type: ChannelType): TemplateProvider | null {
    return this.providers.get(type) ?? null;
  }
}
