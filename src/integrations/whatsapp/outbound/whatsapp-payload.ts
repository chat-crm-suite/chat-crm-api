// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  ResolvedOutgoing,
  ResolvedTemplate,
  TemplateParameter,
} from '@modules/channels/ports/channel-adapter.port';
import type {
  WhatsAppPayload,
  WhatsAppPayloadBase,
  WhatsAppTemplateCard,
  WhatsAppTemplateComponent,
  WhatsAppTemplateMediaParameter,
  WhatsAppTemplateParameter,
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
    case 'template':
      return { ...base, type: 'template', template: toTemplate(message) };
    default:
      return unreachable(message);
  }
}

function toTemplate(template: ResolvedTemplate) {
  const components: WhatsAppTemplateComponent[] = componentsOf(template);
  if (template.cards?.length) {
    components.push({
      type: 'carousel',
      cards: template.cards.map((card) => ({
        card_index: card.index,
        components: componentsOf({ ...card, header: [] }),
      })),
    });
  }

  return {
    name: template.name,
    language: { code: template.language },
    ...(components.length ? { components } : {}),
  };
}

/** Header (file or values), body values and dynamic buttons of a template or card. */
function componentsOf(
  source: Pick<ResolvedTemplate, 'header' | 'body' | 'buttons' | 'headerMedia'>,
): CardComponent[] {
  const components: CardComponent[] = [];
  if (source.headerMedia) {
    // A media header takes exactly its file (no text placeholders).
    components.push({ type: 'header', parameters: [toMediaParameter(source.headerMedia)] });
  } else if (source.header.length) {
    components.push({ type: 'header', parameters: source.header.map(toParameter) });
  }
  if (source.body.length) {
    components.push({ type: 'body', parameters: source.body.map(toParameter) });
  }
  for (const button of source.buttons) {
    if (!button.parameters.length) continue;
    components.push({
      type: 'button',
      sub_type: button.subType,
      index: String(button.index),
      parameters: button.parameters.map(toParameter),
    });
  }
  return components;
}

type CardComponent = WhatsAppTemplateCard['components'][number];

function toMediaParameter({
  type,
  media,
  filename,
}: NonNullable<ResolvedTemplate['headerMedia']>): WhatsAppTemplateMediaParameter {
  const id = media.providerMediaId;
  switch (type) {
    case 'image':
      return { type: 'image', image: { id } };
    case 'video':
      return { type: 'video', video: { id } };
    case 'document':
      return { type: 'document', document: filename ? { id, filename } : { id } };
  }
}

/** Positional placeholders (`{{1}}`) go by order; named ones carry their name. */
function toParameter({ key, value }: TemplateParameter): WhatsAppTemplateParameter {
  return /^\d+$/.test(key)
    ? { type: 'text', text: value }
    : { type: 'text', text: value, parameter_name: key };
}

function withCaption(id: string, caption?: string) {
  return caption ? { id, caption } : { id };
}

function unreachable(message: never): never {
  throw new Error(`Unsupported outgoing message: ${JSON.stringify(message)}`);
}
