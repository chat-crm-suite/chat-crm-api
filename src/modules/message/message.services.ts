import { Injectable } from '@nestjs/common';
import { MessageRepository } from './message.repository';
import { CreateMessageDto } from './entities/create-message.dto';
import { Message } from './message.entity';
import { MessageSenderType, MessageStatus, MessageType } from './message.enum';
import { MessageContent } from '../../integrations/whatsapp/types/whatsapp.types';
import { PinoLogger } from 'nestjs-pino';
import { BroadcastDto } from '../chats/dto/broadcast.dto';
import { getMessageStrategy } from './strategies/strategy.registry';

@Injectable()
export class MessageService {
  constructor(
    private readonly repo: MessageRepository,
    private readonly logger: PinoLogger,
  ) {}

  saveMsg(
    chatId: string,
    msg: MessageContent,
    sender: { id: string; type: MessageSenderType },
    mediaUrl?: string,
  ) {
    switch (msg.type) {
      case 'text':
        return this.repo.createFromChat(
          chatId,
          msg.text.body,
          sender.id,
          sender.type,
          MessageType.TEXT,
        );
      case 'image':
        return this.repo.createFromChat(
          chatId,
          msg.image?.caption ?? '',
          sender.id,
          sender.type,
          MessageType.IMAGE,
        );
      case 'document':
        return this.repo.createFromChat(
          chatId,
          msg.document?.caption ?? '',
          sender.id,
          sender.type,
          MessageType.DOCUMENT,
          mediaUrl,
        );
      default:
        this.logger.warn(msg, 'Only text support');
    }
  }

  async create(dto: CreateMessageDto, chatId: string) {
    return this.repo.create(dto, chatId);
  }

  async getChatMessages(chatId: string): Promise<BroadcastDto[]> {
    const messages = await this.repo.findChatMessages(chatId);
    return messages.map((msg) =>
      getMessageStrategy(msg.type ?? MessageType.TEXT).toBroadcastFields(msg),
    );
  }

  async createSimpleMessage(
    payload: Pick<Message, 'direction' | 'content' | 'mediaUrl'>,
    contactId: string,
    chatId: string,
  ) {
    return this.create(
      {
        senderType: this.inferSender(payload.direction),
        direction: payload.direction,
        body: payload.content,
        mediaUrl: payload.mediaUrl,
        status: MessageStatus.SENT,
        type: this.inferType(payload.mediaUrl),
        contactId,
      },
      chatId,
    );
  }

  private inferType(mediaUrl?: string) {
    return mediaUrl ? MessageType.IMAGE : MessageType.TEXT;
  }

  private inferSender(direction: 'in' | 'out') {
    return direction === 'in'
      ? MessageSenderType.CLIENT
      : MessageSenderType.AGENT;
  }
}
