import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';

import type {
  MessageType,
  WhatsAppDocumentContent,
  WhatsAppTextContent,
} from '../../../../contracts/index';
import { ChannelTransmission } from '../../../../modules/channels/channels.service';
import { ConversationRepository } from '../../../../modules/conversations/conversation.repository';
import { SaveConversationMessageCommand } from '../../../../modules/conversations/commands/save-conversation-message.command';
import { WhatsAppClient } from '../../clients/whatsapp.client';
import {
  DocumentContent,
  ImageContent,
  MessageContent,
  MessageContext,
  TextContent,
} from '../../types/whatsapp.types';
import { ContentHandlerPort } from './content-handler.port';

interface IncomingPayload {
  type: MessageType;
  mediaUrl?: string;
  externalId?: string;
  content: WhatsAppTextContent | WhatsAppDocumentContent;
}

@Injectable()
export class MessageContentHandlers {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly client: WhatsAppClient,
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

    void this.commandBus.execute(
      new SaveConversationMessageCommand({
        msg: payload,
        room: conversation.id,
        companyId: channel.companyId,
        sender: {
          id: customer.id,
          type: 'customer',
        },
      }),
    );  }

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

  private readonly document: ContentHandlerPort<DocumentContent> = {
    handle: async (content, context, transmission) => {
      if (!content?.document?.id) return;

      this.client.setChannel(transmission.channel, transmission.credentials);

      const ext = content.document.filename?.split('.').pop() || undefined;

      const { fileUrl } = await firstValueFrom(
        this.client.upload(
          content.document.id,
          transmission.credentials.accessToken,
          ext,
        ),
      );

      this.logger.debug({ content, fileUrl }, 'Upload document');

      await this.saveMessage(
        context,
        {
          type: 'document',
          mediaUrl: fileUrl,
          externalId: context.messageId,
          content: {
            link: fileUrl,
            caption: content.document.caption,
            filename: content.document.filename,
          },
        },
        transmission,
      );
    },
  };

  private readonly image: ContentHandlerPort<ImageContent> = {
    handle: async (content: ImageContent, context, transmission) => {
      if (!content?.image?.id) return;

      this.client.setChannel(transmission.channel, transmission.credentials);

      const upload$ = this.client.upload(
        content.image.id,
        transmission.credentials.accessToken,
      );

      const { fileUrl } = await firstValueFrom(upload$);

      this.logger.debug({ content, fileUrl }, 'Upload image');

      await this.saveMessage(
        context,
        {
          type: 'image',
          mediaUrl: fileUrl,
          externalId: context.messageId,
          content: {
            link: fileUrl,
            caption: content.image.caption,
          },
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
    };
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- la correlación K→handler se pierde sin el cast en indexed access genérico
    return handlers[type] as
      | ContentHandlerPort<Extract<MessageContent, { type: K }>>
      | undefined;
  }
}
