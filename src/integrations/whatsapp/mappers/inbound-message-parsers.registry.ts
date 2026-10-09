// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  InboundMessage,
  InboundMessageContent,
  InboundMessageContext,
  InboundMessageType,
  InboundWebhookResult,
} from '../types/inbound-message.types';
import type {
  WhatsAppWebhook,
  WhatsAppWebhookContact,
} from '../types/whatsapp-webhook.types';
import {
  mapWebhookToMessages,
  toParsedMessage,
} from './whatsapp-message.mapper';

/**
 * Single type-keyed inbound parser registry (ticket #20 expand, Strategy
 * with functions). Each entry delegates to the existing mapper logic, so the
 * output for every type is the same as today; no caller migrates in this
 * ticket — later tickets point the router at `parseInboundMessage` /
 * `mapInboundWebhookToMessages` and delete the old names.
 *
 * Pure translation: no awaits, no repositories, no loggers.
 */
export type InboundMessageParser = (
  message: unknown,
  context: InboundMessageContext,
) => InboundMessageContent | undefined;

/** One shared delegation: the legacy mapper stays the source of truth. */
const viaLegacyMapper: InboundMessageParser = (message, context) =>
  toParsedMessage(message, context.phoneNumberId, context.senderName)?.content;

export const inboundMessageParsers: Record<
  InboundMessageType,
  InboundMessageParser
> = {
  text: viaLegacyMapper,
  image: viaLegacyMapper,
  document: viaLegacyMapper,
  audio: viaLegacyMapper,
  video: viaLegacyMapper,
  sticker: viaLegacyMapper,
  location: viaLegacyMapper,
  contacts: viaLegacyMapper,
  interactive: viaLegacyMapper,
  reaction: viaLegacyMapper,
  button: viaLegacyMapper,
};

/**
 * Resolves one raw provider message through the registry. Unknown types
 * yield `undefined` (discard), exactly like the legacy switch default.
 */
export const parseInboundMessage = (
  message: unknown,
  context: InboundMessageContext,
): InboundMessage | undefined => {
  const type =
    typeof message === 'object' && message !== null
      ? (message as { type?: unknown }).type
      : undefined;
  const parser =
    typeof type === 'string'
      ? inboundMessageParsers[type as InboundMessageType]
      : undefined;
  if (!parser) return undefined;

  const content = parser(message, context);
  if (!content) return undefined;
  return { context, content };
};

/**
 * Rehydrates a single message stored by the durable intake into the
 * normalized shape. Replay never re-parses a webhook: the stored payload is
 * the source of truth. Mirrors `toParsedMessage` (same guard, same context).
 */
export const toInboundMessage = (
  message: unknown,
  phoneNumberId?: string | null,
  senderName?: string,
): InboundMessage | undefined => {
  if (
    !message ||
    typeof message !== 'object' ||
    typeof (message as { id?: unknown }).id !== 'string' ||
    (message as { id: string }).id.length === 0 ||
    typeof (message as { from?: unknown }).from !== 'string'
  ) {
    return undefined;
  }

  const stored = message as { id: string; from: string };
  const context: InboundMessageContext = {
    phoneNumberId: phoneNumberId ?? '',
    from: stored.from,
    messageId: stored.id,
    senderName,
  };

  return parseInboundMessage(message, context);
};

const toContactMap = (
  contacts: WhatsAppWebhookContact[],
): Record<string, WhatsAppWebhookContact> =>
  Object.fromEntries(
    contacts.map((c): [string, WhatsAppWebhookContact] => [c.wa_id, c]),
  );

/**
 * New webhook entry point beside `mapWebhookToMessages`: same traversal,
 * same degradation, but each message resolves through `parseInboundMessage`
 * (the registry). Parity with the legacy output is pinned by
 * `inbound-message-parsers.registry.spec.ts`.
 */
export const mapInboundWebhookToMessages = (
  body: WhatsAppWebhook,
): InboundWebhookResult => {
  if (body?.object !== 'whatsapp_business_account')
    return { messages: [], errors: [], statuses: [] };

  const changes = body.entry
    .flatMap(({ changes }) => changes)
    .filter(({ field }) => field === 'messages');

  const messages = changes
    .filter(({ value }) => value.messages?.length)
    .flatMap(({ value }) => {
      const contacts = toContactMap(value.contacts ?? []);
      return (value.messages ?? []).flatMap((msg) => {
        const context: InboundMessageContext = {
          phoneNumberId: value.metadata.phone_number_id,
          from: msg.from,
          messageId: msg.id,
          senderName: contacts[msg.from]?.profile?.name,
        };
        const parsed = parseInboundMessage(msg, context);
        return parsed ? [parsed] : [];
      });
    });

  const statuses = changes.flatMap(({ value }) => value.statuses ?? []);

  const errors = changes
    .flatMap(({ value }) => value.statuses ?? [])
    .flatMap((status) => status?.errors ?? []);

  return { messages, statuses, errors };
};

/** Legacy entry points keep working; prefer the `Inbound` names above. */
export { mapWebhookToMessages, toParsedMessage };
