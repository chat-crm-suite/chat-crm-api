// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { ChannelTransmission } from '@modules/channels/channels.service';
import { ConversationRepository } from '@modules/conversations/conversation.repository';
import { SaveConversationMessageCommand } from '@modules/conversations/commands/save-conversation-message.command';
import type { ConversationMessage } from '../../types/conversation-message.types';
import {
  InboundAudioContent,
  InboundContactContent,
  InboundContactPerson,
  InboundDocumentContent,
  InboundImageContent,
  InboundInteractiveContent,
  InboundLocationContent,
  InboundMessageContent,
  InboundMessageContext,
  InboundReactionContent,
  InboundStickerContent,
  InboundTextContent,
  InboundVideoContent,
} from '../../types/inbound-message.types';
import { InboundSaveStrategyPort } from './inbound-save-strategy.port';

/**
 * The Inbound Router (glossary): the single type-keyed dispatch that resolves
 * an inbound message to the save behavior for its content type. Every strategy
 * hands the router a layer-3 `ConversationMessage` body (`msg`), and the
 * router owns resolving the customer identity plus the conversation and
 * enqueuing the save.
 */
@Injectable()
export class InboundMessageRouter {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly commandBus: CommandBus,
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Resolves the customer identity + conversation for the incoming webhook
   * message (v2: `customer_identities` is the canon) and enqueues the save.
   */
  private async saveMessage(
    context: InboundMessageContext,
    message: ConversationMessage['msg'],
    transmission: ChannelTransmission,
  ): Promise<void> {
    const { channel } = transmission;

    const { conversation, customer } =
      await this.conversations.findOrCreateIncoming({
        companyId: channel.companyId,
        channelId: channel.id,
        externalId: context.from,
        phoneNumber: context.from,
        profileName: context.senderName,
      });

    const payload: ConversationMessage = {
      room: conversation.id,
      companyId: channel.companyId,
      sender: {
        id: customer.id,
        type: 'customer',
      },
      msg: message,
    };

    await this.commandBus.execute(new SaveConversationMessageCommand(payload));
  }

  private readonly text: InboundSaveStrategyPort<InboundTextContent> = {
    handle: async (content, context, transmission) => {
      await this.saveMessage(
        context,
        {
          type: 'text',
          externalId: context.messageId,
          content: {
            body: content.text.body,
            preview_url: content.text.preview_url,
          },
        },
        transmission,
      );
    },
  };

  private readonly image: InboundSaveStrategyPort<InboundImageContent> = {
    handle: async (content, context, transmission) => {
      const media = content.image;

      await this.saveMessage(
        context,
        {
          type: 'image',
          externalId: context.messageId,
          externalMediaId: media?.id,
          mimeType: media?.mime_type,
          content: {
            caption: media?.caption,
          },
        },
        transmission,
      );
    },
  };

  private readonly document: InboundSaveStrategyPort<InboundDocumentContent> = {
    handle: async (content, context, transmission) => {
      const media = content.document;

      await this.saveMessage(
        context,
        {
          type: 'document',
          externalId: context.messageId,
          externalMediaId: media?.id,
          mimeType: media?.mime_type,
          content: {
            caption: media?.caption,
            filename: media?.filename,
          },
        },
        transmission,
      );
    },
  };

  private readonly audio: InboundSaveStrategyPort<InboundAudioContent> = {
    handle: async (content, context, transmission) => {
      const media = content.audio;

      await this.saveMessage(
        context,
        {
          type: 'audio',
          externalId: context.messageId,
          externalMediaId: media?.id,
          mimeType: media?.mime_type,
          content: {},
        },
        transmission,
      );
    },
  };

  private readonly video: InboundSaveStrategyPort<InboundVideoContent> = {
    handle: async (content, context, transmission) => {
      const media = content.video;

      await this.saveMessage(
        context,
        {
          type: 'video',
          externalId: context.messageId,
          externalMediaId: media?.id,
          mimeType: media?.mime_type,
          content: {
            caption: media?.caption,
            filename: media?.filename,
          },
        },
        transmission,
      );
    },
  };

  private readonly sticker: InboundSaveStrategyPort<InboundStickerContent> = {
    handle: async (content, context, transmission) => {
      const media = content.sticker;

      await this.saveMessage(
        context,
        {
          type: 'sticker',
          externalId: context.messageId,
          externalMediaId: media?.id,
          mimeType: media?.mime_type,
          content: {},
        },
        transmission,
      );
    },
  };

  private readonly location: InboundSaveStrategyPort<InboundLocationContent> = {
    handle: async (content, context, transmission) => {
      await this.saveMessage(
        context,
        {
          type: 'location',
          externalId: context.messageId,
          content: { body: formatLocation(content.location) },
        },
        transmission,
      );
    },
  };

  private readonly contact: InboundSaveStrategyPort<InboundContactContent> = {
    handle: async (content, context, transmission) => {
      await this.saveMessage(
        context,
        {
          type: 'contact',
          externalId: context.messageId,
          content: { body: formatContacts(content.contacts) },
        },
        transmission,
      );
    },
  };

  private readonly interactive: InboundSaveStrategyPort<InboundInteractiveContent> =
    {
      handle: async (content, context, transmission) => {
        await this.saveMessage(
          context,
          {
            type: 'interactive',
            externalId: context.messageId,
            content: { body: formatInteractive(content.interactive) },
          },
          transmission,
        );
      },
    };

  private readonly reaction: InboundSaveStrategyPort<InboundReactionContent> = {
    handle: async (content, context, transmission) => {
      await this.saveMessage(
        context,
        {
          type: 'reaction',
          externalId: context.messageId,
          content: { body: formatReaction(content.reaction) },
        },
        transmission,
      );
    },
  };

  /** The single type-keyed dispatch: content type -> its save strategy. */
  resolve<K extends InboundMessageContent['type']>(type: K) {
    const strategies: {
      [K in InboundMessageContent['type']]?: InboundSaveStrategyPort<
        Extract<InboundMessageContent, { type: K }>
      >;
    } = {
      text: this.text,
      image: this.image,
      document: this.document,
      audio: this.audio,
      video: this.video,
      sticker: this.sticker,
      location: this.location,
      contact: this.contact,
      interactive: this.interactive,
      reaction: this.reaction,
    };
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- la correlación K→strategy se pierde sin el cast en indexed access genérico
    return strategies[type] as
      | InboundSaveStrategyPort<Extract<InboundMessageContent, { type: K }>>
      | undefined;
  }
}

/** Short readable row for location messages. */
export function formatLocation(
  location?: InboundLocationContent['location'],
): string {
  if (!location) return '📍 Ubicación no disponible';

  const coords = `${location.latitude}, ${location.longitude}`;
  const label = location.name ?? location.address;
  return label ? `📍 ${label}: ${coords}` : `📍 Ubicación: ${coords}`;
}

/** Short readable row for contact cards (one or several people). */
export function formatContacts(contacts?: InboundContactPerson[]): string {
  if (!contacts?.length) return '👤 Contacto no disponible';

  return contacts
    .map((person) => {
      const composed = [person.name?.first_name, person.name?.last_name]
        .filter(Boolean)
        .join(' ');
      const name = person.name?.formatted_name || composed || 'Contacto';
      const phone = person.phones?.[0]?.phone;
      return phone ? `👤 ${name} · ${phone}` : `👤 ${name}`;
    })
    .join(' | ');
}

/** Short readable row for button/list replies. */
export function formatInteractive(
  interactive?: InboundInteractiveContent['interactive'],
): string {
  if (interactive?.button_reply?.title) {
    return `🔘 ${interactive.button_reply.title}`;
  }
  if (interactive?.list_reply?.title) {
    return `📋 ${interactive.list_reply.title}`;
  }
  return '💬 Mensaje interactivo';
}

/** Short readable row for reactions (empty emoji = removed). */
export function formatReaction(
  reaction?: InboundReactionContent['reaction'],
): string {
  return reaction?.emoji ? `Reacción: ${reaction.emoji}` : 'Reacción eliminada';
}
