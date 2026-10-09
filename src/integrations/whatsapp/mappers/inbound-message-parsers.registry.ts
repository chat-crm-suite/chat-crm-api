// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  InboundAudioContent,
  InboundContactContent,
  InboundDiscard,
  InboundDiscardReason,
  InboundDocumentContent,
  InboundLocationContent,
  InboundMessage,
  InboundMessageContent,
  InboundMessageContext,
  InboundMessageType,
  InboundStickerContent,
  InboundTextContent,
  InboundVideoContent,
  InboundWebhookResult,
} from '../types/inbound-message.types';
import type {
  WhatsAppWebhookContact,
  WhatsAppWebhookError,
  WhatsAppWebhookStatus,
} from '../types/whatsapp-webhook.types';

/**
 * Single type-keyed inbound parser registry (ticket #21 strict, Strategy
 * with functions). Each entry validates its required fields and discards
 * (`undefined`) when essentials are missing — never invented defaults.
 *
 * Pure translation: no awaits, no repositories, no loggers.
 */
export type InboundMessageParser = (
  message: unknown,
) => InboundMessageContent | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Strict text parser (ticket #21): a missing, empty or blank body is a
 * discard — never an invented `{ body: '' }`. Valid bodies pass through
 * untouched.
 */
const parseText: InboundMessageParser = (message) => {
  if (!isRecord(message)) return undefined;
  const text = message.text;
  if (!isRecord(text) || !nonEmptyString(text.body)) return undefined;
  return {
    type: 'text',
    text: text as InboundTextContent['text'],
  };
};

/**
 * Strict image parser (ticket #21): media without its provider id is a
 * discard. Valid payloads pass through untouched (caption, mime_type and
 * any other provider field survive).
 */
const parseImage: InboundMessageParser = (message) => {
  if (!isRecord(message)) return undefined;
  const image = message.image;
  if (!isRecord(image) || !nonEmptyString(image.id)) return undefined;
  return {
    type: 'image',
    image,
  };
};

/**
 * One strict parser per media type (ticket #21): the provider media id is
 * required, everything else passes through untouched. Shared shape, so a
 * single factory covers document, audio, video and sticker.
 */
const mediaParser =
  (
    fragment: 'document' | 'audio' | 'video' | 'sticker',
  ): InboundMessageParser =>
  (message) => {
    if (!isRecord(message)) return undefined;
    const payload = message[fragment];
    if (!isRecord(payload) || !nonEmptyString(payload.id)) return undefined;
    switch (fragment) {
      case 'document':
        return {
          type: 'document',
          document: payload as InboundDocumentContent['document'],
        };
      case 'audio':
        return {
          type: 'audio',
          audio: payload as InboundAudioContent['audio'],
        };
      case 'video':
        return {
          type: 'video',
          video: payload as InboundVideoContent['video'],
        };
      case 'sticker':
        return {
          type: 'sticker',
          sticker: payload as InboundStickerContent['sticker'],
        };
    }
  };

/** Strict location parser: both coordinates must be finite numbers. */
const parseLocation: InboundMessageParser = (message) => {
  if (!isRecord(message)) return undefined;
  const location = message.location;
  if (!isRecord(location)) return undefined;
  const { latitude, longitude } = location;
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return undefined;
  }
  return {
    type: 'location',
    location: location as InboundLocationContent['location'],
  };
};

/** Strict contacts parser: the list must exist and hold at least one entry. */
const parseContacts: InboundMessageParser = (message) => {
  if (!isRecord(message)) return undefined;
  const contacts = message.contacts;
  if (!Array.isArray(contacts) || contacts.length === 0) return undefined;
  return {
    type: 'contact',
    contacts: contacts as InboundContactContent['contacts'],
  };
};

/**
 * Strict provider legacy-button parser: at least the payload or the text must
 * be present — both missing is a discard, never a reply with empty id/title.
 */
const parseButton: InboundMessageParser = (message) => {
  if (!isRecord(message)) return undefined;
  const button = message.button;
  if (!isRecord(button)) return undefined;
  if (!nonEmptyString(button.payload) && !nonEmptyString(button.text)) {
    return undefined;
  }
  return {
    type: 'interactive',
    interactive: {
      type: 'button_reply',
      button_reply: {
        id: button.payload as string | undefined,
        title: button.text as string | undefined,
      },
    },
  };
};

/**
 * Strict interactive parser: an absent or empty interactive payload is a
 * discard; any provider-shaped payload passes through untouched.
 */
const parseInteractive: InboundMessageParser = (message) => {
  if (!isRecord(message)) return undefined;
  const interactive = message.interactive;
  if (!isRecord(interactive) || Object.keys(interactive).length === 0) {
    return undefined;
  }
  return {
    type: 'interactive',
    interactive,
  };
};

/**
 * Strict reaction parser: the target message id is required (an empty emoji
 * stays valid — it signals a reaction removal).
 */
const parseReaction: InboundMessageParser = (message) => {
  if (!isRecord(message)) return undefined;
  const reaction = message.reaction;
  if (!isRecord(reaction) || !nonEmptyString(reaction.message_id)) {
    return undefined;
  }
  return {
    type: 'reaction',
    reaction,
  };
};

/**
 * Single type-keyed inbound parser registry (ticket #21 strict, Strategy
 * with functions). Each entry validates its required fields and discards
 * (`undefined`) when essentials are missing — never invented defaults.
 *
 * Pure translation: no awaits, no repositories, no loggers.
 */

export const inboundMessageParsers: Record<
  InboundMessageType,
  InboundMessageParser
> = {
  text: parseText,
  image: parseImage,
  document: mediaParser('document'),
  audio: mediaParser('audio'),
  video: mediaParser('video'),
  sticker: mediaParser('sticker'),
  location: parseLocation,
  contacts: parseContacts,
  interactive: parseInteractive,
  reaction: parseReaction,
  button: parseButton,
};

/**
 * One strict reason per known type: when its parser discards, this is why.
 * Kept beside the registry so content and reason can never drift apart.
 */
const DISCARD_REASONS: Record<InboundMessageType, InboundDiscardReason> = {
  text: 'missing-text-body',
  image: 'missing-media-id',
  document: 'missing-media-id',
  audio: 'missing-media-id',
  video: 'missing-media-id',
  sticker: 'missing-media-id',
  location: 'missing-location-coordinates',
  contacts: 'missing-contacts',
  interactive: 'missing-interactive-payload',
  reaction: 'missing-reaction-target',
  button: 'missing-button-payload',
};

type ParserOutcome =
  { content: InboundMessageContent } | { discard: InboundDiscardReason };

/** Single internal run: content on success, the strict reason on discard. */
const runParser = (message: unknown): ParserOutcome => {
  if (!isRecord(message)) return { discard: 'invalid-message' };
  const { type } = message;
  const parser =
    typeof type === 'string'
      ? inboundMessageParsers[type as InboundMessageType]
      : undefined;
  if (!parser) return { discard: 'unknown-type' };
  const content = parser(message);
  if (!content) {
    return { discard: DISCARD_REASONS[type as InboundMessageType] };
  }
  return { content };
};

const typeNameOf = (message: Record<string, unknown>): string =>
  typeof message.type === 'string' && message.type.length > 0
    ? message.type
    : 'unknown';

/**
 * Resolves one raw provider message through the registry. Unknown types and
 * invalid payloads yield `undefined` (discard) — never invented defaults.
 */
export const parseInboundMessage = (
  message: unknown,
  context: InboundMessageContext,
): InboundMessage | undefined => {
  const outcome = runParser(message);
  if ('discard' in outcome) return undefined;
  return { context, content: outcome.content };
};

/**
 * Pure discard description: why `parseInboundMessage` would drop this raw
 * message, with its id and type for correlation. `undefined` when the
 * message parses — there is no discard to report. No logging, no bus: the
 * publishing border owns those effects.
 */
export const describeInboundDiscard = (
  message: unknown,
): InboundDiscard | undefined => {
  const outcome = runParser(message);
  if ('content' in outcome) return undefined;
  if (!isRecord(message)) {
    return { messageId: 'unknown', type: 'unknown', reason: outcome.discard };
  }
  const { id } = message;
  return {
    messageId: nonEmptyString(id) ? id : 'unknown',
    type: typeNameOf(message),
    reason: outcome.discard,
  };
};

/**
 * Rehydrates a single message stored by the durable intake into the
 * normalized shape. Replay never re-parses a webhook: the stored payload is
 * the source of truth. Same guard and context as the live parse path.
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
  contacts: unknown[],
): Record<string, WhatsAppWebhookContact> =>
  Object.fromEntries(
    contacts
      .filter(
        (c): c is WhatsAppWebhookContact =>
          isRecord(c) && typeof c.wa_id === 'string',
      )
      .map((c): [string, WhatsAppWebhookContact] => [c.wa_id, c]),
  );

/** One discard fact per discarded message; pure parsers never call it. */
export type InboundDiscardListener = (discard: InboundDiscard) => void;

/**
 * Single webhook entry point: each message resolves through the strict
 * registry, and every discard is reported once through `onDiscard` (id, type,
 * reason) for the publishing border.
 *
 * Defensive by construction: a foreign body, a missing entry list, entries
 * without changes, values without metadata or channel id, and non-object
 * messages all degrade to empty or omitted — never a TypeError.
 */
export const mapInboundWebhookToMessages = (
  body: unknown,
  onDiscard?: InboundDiscardListener,
): InboundWebhookResult => {
  const empty: InboundWebhookResult = {
    messages: [],
    errors: [],
    statuses: [],
  };
  if (!isRecord(body) || body.object !== 'whatsapp_business_account') {
    return empty;
  }
  if (!Array.isArray(body.entry)) return empty;

  const notify = (discard: InboundDiscard): void => {
    onDiscard?.(discard);
  };

  const messages: InboundMessage[] = [];
  const statuses: WhatsAppWebhookStatus[] = [];
  const errors: WhatsAppWebhookError[] = [];

  for (const entry of body.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || change.field !== 'messages') continue;
      const value = change.value;
      if (!isRecord(value)) continue;

      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          statuses.push(status as WhatsAppWebhookStatus);
          if (isRecord(status) && Array.isArray(status.errors)) {
            for (const error of status.errors) {
              errors.push(error as WhatsAppWebhookError);
            }
          }
        }
      }

      const rawMessages = Array.isArray(value.messages) ? value.messages : [];
      if (rawMessages.length === 0) continue;

      const metadata = isRecord(value.metadata) ? value.metadata : undefined;
      const phoneNumberId = metadata?.phone_number_id;
      if (!nonEmptyString(phoneNumberId)) {
        for (const raw of rawMessages) {
          notify(channelDiscardOf(raw));
        }
        continue;
      }

      const contacts = toContactMap(
        Array.isArray(value.contacts) ? value.contacts : [],
      );
      for (const raw of rawMessages) {
        if (!isRecord(raw)) {
          notify({
            messageId: 'unknown',
            type: 'unknown',
            reason: 'invalid-message',
          });
          continue;
        }
        const { id, from } = raw;
        const type = typeNameOf(raw);
        if (!nonEmptyString(id)) {
          notify({ messageId: 'unknown', type, reason: 'missing-message-id' });
          continue;
        }
        if (!nonEmptyString(from)) {
          notify({ messageId: id, type, reason: 'missing-sender' });
          continue;
        }
        const context: InboundMessageContext = {
          phoneNumberId,
          from,
          messageId: id,
          senderName: contacts[from]?.profile?.name,
        };
        const outcome = runParser(raw);
        if ('discard' in outcome) {
          notify({ messageId: id, type, reason: outcome.discard });
          continue;
        }
        messages.push({ context, content: outcome.content });
      }
    }
  }

  return { messages, statuses, errors };
};

/** A message skipped for lack of channel id still names itself when it can. */
const channelDiscardOf = (raw: unknown): InboundDiscard => {
  if (!isRecord(raw)) {
    return {
      messageId: 'unknown',
      type: 'unknown',
      reason: 'missing-channel-id',
    };
  }
  const { id } = raw;
  return {
    messageId: nonEmptyString(id) ? id : 'unknown',
    type: typeNameOf(raw),
    reason: 'missing-channel-id',
  };
};
