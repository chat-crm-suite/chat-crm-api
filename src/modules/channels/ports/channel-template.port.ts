// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  ChannelType,
  TemplateCategory,
  TemplateComponent,
  TemplateComponentType,
  TemplateStatus,
} from '@contracts';
import type { ChannelOutcome, ResolvedTemplate } from './channel-adapter.port';

/** A placeholder found in a provider template, with its sample value. */
export interface RemoteTemplateVariable {
  key: string;
  component: TemplateComponentType;
  example: string | null;
}

/** One provider template, already normalized to the neutral contract shapes. */
export interface RemoteTemplate {
  externalId: string | null;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  statusReason: string | null;
  components: TemplateComponent[];
  variables: RemoteTemplateVariable[];
}

/** What a stored template needs to be sent again through its provider. */
export interface SendableTemplate {
  name: string;
  language: string;
  components: TemplateComponent[];
  variables: RemoteTemplateVariable[];
}

/**
 * Provider-approved templates of one messaging provider (WhatsApp HSM today).
 * Optional: a channel type without templates simply registers none, and
 * `channelCapabilities(type).supportsTemplates` stays false. The templates
 * module only talks to this port, never to a provider API.
 */
export interface TemplateProvider {
  readonly type: ChannelType;
  /** Every template of the channel's provider account, normalized. */
  listRemote(channelId: string): Promise<ChannelOutcome<{ templates: RemoteTemplate[] }>>;
  /**
   * The send-ready template with `params` (`${component}:${key}` -> value)
   * placed in the provider's order. Callers validate that every variable has
   * a value first.
   */
  buildSend(
    template: SendableTemplate,
    params: Readonly<Record<string, string>>,
  ): ResolvedTemplate;
}
