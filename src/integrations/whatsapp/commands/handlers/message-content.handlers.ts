import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import type {
  MessageType,
  WhatsAppDocumentContent,
  WhatsAppTextContent,
} from '../../../../contracts/index';
import { ChannelTransmission } from '../../../../modules/channels/channels.service';
import { ConversationRepository } from '../../../../modules/conversations/conversation.repository';
import { SaveConversationMessageCommand } from '../../../../modules/conversations/commands/save-conversation-message.command';
import {
  AudioContent,
  ContactContent,
  ContactPerson,
  DocumentContent,
  ImageContent,
  InteractiveContent,
  LocationContent,
  MessageContent,
  MessageContext,
  ReactionContent,
  StickerContent,
  TextContent,
  VideoContent,
} from '../../types/whatsapp.types';
import { ContentHandlerPort } from './content-handler.port';

interface IncomingPayload {
  type: MessageType;
  mediaUrl?: string;
  externalId?: string;
  externalMediaId?: string;
  mimeType?: string;
  content: WhatsAppTextContent | WhatsAppDocumentContent;
}

@Injectable()
export class MessageContentHandlers {
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
    context: MessageContext,
    payload: IncomingPayload,
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

    await this.commandBus.execute(
      new SaveConversationMessageCommand({
        msg: payload,
        room: conversation.id,
        companyId: channel.companyId,
        sender: {
          id: customer.id,
          type: 'customer',
        },
      }),
    );
  }

  private readonly text: ContentHandlerPort<TextContent> = {
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

  private readonly image: ContentHandlerPort<ImageContent> = {
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

  private readonly document: ContentHandlerPort<DocumentContent> = {
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

  private readonly audio: ContentHandlerPort<AudioContent> = {
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

  private readonly video: ContentHandlerPort<VideoContent> = {
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

  private readonly sticker: ContentHandlerPort<StickerContent> = {
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

  private readonly location: ContentHandlerPort<LocationContent> = {
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

  private readonly contact: ContentHandlerPort<ContactContent> = {
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

  private readonly interactive: ContentHandlerPort<InteractiveContent> = {
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

  private readonly reaction: ContentHandlerPort<ReactionContent> = {
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

  getHandler<K extends MessageContent['type']>(type: K) {
    const handlers: {
      [K in MessageContent['type']]?: ContentHandlerPort<
        Extract<MessageContent, { type: K }>
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- la correlación K→handler se pierde sin el cast en indexed access genérico
    return handlers[type] as
      | ContentHandlerPort<Extract<MessageContent, { type: K }>>
      | undefined;
  }
}

/** Short readable row for location messages. */
export function formatLocation(
  location?: LocationContent['location'],
): string {
  if (!location) return '📍 Ubicación no disponible';

  const coords = `${location.latitude}, ${location.longitude}`;
  const label = location.name ?? location.address;
  return label ? `📍 ${label}: ${coords}` : `📍 Ubicación: ${coords}`;
}

/** Short readable row for contact cards (one or several people). */
export function formatContacts(contacts?: ContactPerson[]): string {
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
  interactive?: InteractiveContent['interactive'],
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
export function formatReaction(reaction?: ReactionContent['reaction']): string {
  return reaction?.emoji ? `Reacción: ${reaction.emoji}` : 'Reacción eliminada';
}
