// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ResolvedOutgoing } from '@modules/channels/ports/channel-adapter.port';
import type {
  WhatsAppPayload,
  WhatsAppPayloadBase,
} from '../interfaces/whatsapp-message.interface';

/**
 * Pure translation of a resolved outgoing message into the Graph request
 * body. Exhaustive over the message kinds: adding one without its mapping is
 * a compile error, never a runtime surprise. Optional fields are omitted
 * rather than sent empty.
 */
export function toWhatsAppPayload(
  recipient: string,
  message: ResolvedOutgoing,
): WhatsAppPayload {
  const base: WhatsAppPayloadBase = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
  };

  switch (message.type) {
    case 'text':
      return { ...base, type: 'text', text: { body: message.text } };
    case 'image':
      return {
        ...base,
        type: 'image',
        image: withCaption(message.media.providerMediaId, message.caption),
      };
    case 'video':
      return {
        ...base,
        type: 'video',
        video: withCaption(message.media.providerMediaId, message.caption),
      };
    case 'audio':
      return {
        ...base,
        type: 'audio',
        audio: { id: message.media.providerMediaId },
      };
    case 'document':
      return {
        ...base,
        type: 'document',
        document: {
          ...withCaption(message.media.providerMediaId, message.caption),
          filename: message.filename,
        },
      };
    case 'sticker':
      return {
        ...base,
        type: 'sticker',
        sticker: { id: message.media.providerMediaId },
      };
    default:
      return unreachable(message);
  }
}

function withCaption(id: string, caption?: string) {
  return caption ? { id, caption } : { id };
}

function unreachable(message: never): never {
  throw new Error(`Unsupported outgoing message: ${JSON.stringify(message)}`);
}
