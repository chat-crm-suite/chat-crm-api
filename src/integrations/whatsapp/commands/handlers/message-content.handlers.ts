import { Injectable } from '@nestjs/common';
import { ContentHandlerPort } from './content-handler.port';
import {
  DocumentContent,
  ImageContent,
  MessageContent,
  MessageContext,
  TextContent,
} from '../../types/whatsapp.types';
import { CommandBus } from '@nestjs/cqrs';
import { SaveChatMessageCommand } from '../../../../modules/chats/commands/index';
import { MessageSenderType, MessageType } from '../../../../modules/message/message.enum';
import { ChatRepository } from '../../../../modules/chats/chat.repository';
import { WhatsAppClient } from '../../clients/whatsapp.client';
import { PinoLogger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class MessageContentHandlers {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly client: WhatsAppClient,
    private readonly commandBus: CommandBus,
    private readonly logger: PinoLogger,
  ) {}

  private async saveMessage(
    context: MessageContext,
    payload: SaveChatMessageCommand['data']['msg'],
    companyId?: string,
  ): Promise<void> {
    const chat = await this.chatRepository.findOrCreateChatByPhone(context, companyId);

    void this.commandBus.execute(
      new SaveChatMessageCommand({
        msg: payload,
        room: chat.id,
        companyId,
        sender: {
          id: chat.client.id,
          type: MessageSenderType.CLIENT,
        },
      }),
    );
  }

  private readonly text: ContentHandlerPort<TextContent> = {
    handle: async (content, context, config) => {
      await this.saveMessage(context, {
        type: MessageType.TEXT,
        content: {
          body: content.text.body,
          preview_url: content.text.preview_url,
        },
      }, config?.company?.id);
    },
  };

  private readonly document: ContentHandlerPort<DocumentContent> = {
    handle: async (content, context, config) => {
      if (!config || !content?.document?.id) return;

      this.client.setConfig(config);

      const ext = content.document.filename?.split('.').pop() || undefined;

      const { fileUrl } = await firstValueFrom(
        this.client.upload(content.document.id, config.accessToken, ext),
      );

      this.logger.debug({ content, imageUrl: fileUrl }, 'Upload document');

      await this.saveMessage(context, {
        type: MessageType.DOCUMENT,
        mediaUrl: fileUrl,
        content: {
          ...content.document,
          link: fileUrl,
          preview_url: content.document.mime_type === 'application/pdf',
        },
      }, config.company?.id);
    },
  };

  private readonly image: ContentHandlerPort<ImageContent> = {
    handle: async (content: ImageContent, context, config) => {
      if (!config || !content?.image?.id) return;

      this.client.setConfig(config);

      const upload$ = this.client.upload(content.image.id, config.accessToken);

      const { fileUrl } = await firstValueFrom(upload$);

      this.logger.debug({ content, imageUrl: fileUrl }, 'Upload image');

      await this.saveMessage(context, {
        type: MessageType.IMAGE,
        mediaUrl: fileUrl,
        content: {
          id: content.image.id,
          link: fileUrl,
          caption: content.image.caption,
        },
      }, config.company?.id);
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
