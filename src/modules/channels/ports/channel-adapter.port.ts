// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ChannelType } from '@contracts';

/** A file stored on our side, ready to be handed to a provider. */
export interface StoredMedia {
  absolutePath: string;
  mimeType: string;
  filename: string;
  sizeBytes: number;
}

/** A media file the provider already holds (its own id for it). */
export interface ProviderMedia {
  providerMediaId: string;
  mimeType: string;
}

/**
 * The outgoing message once its files live at the provider: what an adapter
 * translates to its own API. Same kinds as the shared `OutgoingMessage`.
 */
export type ResolvedOutgoing =
  | { type: 'text'; text: string }
  | { type: 'image'; media: ProviderMedia; caption?: string }
  | { type: 'video'; media: ProviderMedia; caption?: string }
  | { type: 'audio'; media: ProviderMedia; voice: boolean }
  | {
      type: 'document';
      media: ProviderMedia;
      filename: string;
      caption?: string;
    }
  | { type: 'sticker'; media: ProviderMedia }
  | ({ type: 'template' } & ResolvedTemplate);

/** One filled placeholder of a template (`key` without braces: `1`, `name`). */
export interface TemplateParameter {
  key: string;
  value: string;
}

/**
 * A provider template ready to send: its provider name + language and the
 * values of its placeholders per component, in the provider's order. Built by
 * the channel's `TemplateProvider`.
 */
export interface ResolvedTemplate {
  name: string;
  language: string;
  header: TemplateParameter[];
  body: TemplateParameter[];
  /** Dynamic buttons (e.g. a URL suffix), by button position. */
  buttons: Array<{ index: number; subType: string; parameters: TemplateParameter[] }>;
}

/** How a provider failure must be handled by the caller. */
export interface ChannelFailure {
  /** Authorization fault: retrying only burns quota. */
  authFault: boolean;
  /** Transport/server fault worth retrying with backoff. */
  retryable: boolean;
  code?: string;
  message: string;
  /**
   * The provider's free-reply window is closed: only an approved template
   * can reach the customer (WhatsApp 24 h rule, Messenger 24 h…).
   */
  replyWindowClosed?: boolean;
}

export type ChannelOutcome<T> =
  | ({ ok: true } & T)
  | { ok: false; error: ChannelFailure };

/**
 * One messaging provider (WhatsApp Cloud API today; Telegram, Messenger…
 * later). The pipeline only talks to this port: it never sees provider
 * payloads, credentials or URLs. Each adapter resolves its own transmission
 * from the channel id.
 */
export interface ChannelAdapter {
  readonly type: ChannelType;

  /** Uploads a stored file and returns the provider's reference to it. */
  uploadMedia(
    channelId: string,
    file: StoredMedia,
  ): Promise<ChannelOutcome<{ providerMediaId: string }>>;

  /** Delivers one message; `externalId` is the provider message id. */
  send(
    channelId: string,
    recipient: string,
    message: ResolvedOutgoing,
  ): Promise<ChannelOutcome<{ externalId: string }>>;
}
