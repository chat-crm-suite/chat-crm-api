import {
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { CommandBus, EventBus } from '@nestjs/cqrs';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { Message } from '../message/entities/message.entity';
import { getMessageStrategy } from '../message/strategies/strategy.registry';
import { SendWhatsAppMessageCommand } from '../../integrations/whatsapp/commands/send-whatsapp-message.command';
import { ConversationsService } from './conversations.service';
import { ConversationMessageDto } from './dto/conversation-message.dto';
import { SendConversationMessageDto } from './dto/send-conversation-message.dto';
import { ConversationMessageSentEvent } from './events/conversation-message-sent.event';
import { MessageSavedEvent } from './events/message-saved.event';

@Processor('chat')
export class ConversationProcessor extends WorkerHost {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly eventBus: EventBus,
    private readonly conversations: ConversationsService,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(ConversationProcessor.name);
  }

  sendMessageToWhatsapp(data: SendConversationMessageDto) {
    this.logger.debug('Execute send whatsapp client');
    try {
      const strategy = getMessageStrategy(data.msg.type);
      const payload = strategy.toWhatsAppPayload(data.to, data.msg.content);
      void this.commandBus.execute(
        new SendWhatsAppMessageCommand(payload, data.companyId),
      );
    } catch (e) {
      this.logger.error(e, 'Error building whatsapp payload');
    }
  }

  saveConversationMessage(data: SendConversationMessageDto | ConversationMessageDto) {
    return this.conversations.saveMsg(
      data.room,
      data.msg,
      data.sender,
      data.companyId,
    );
  }

  async process(job: Job<SendConversationMessageDto | ConversationMessageDto>) {
    switch (job.name) {
      case 'send-message': {
        this.sendMessageToWhatsapp(job.data as SendConversationMessageDto);
        break;
      }
      case 'save-message':
        return await this.saveConversationMessage(job.data);
      default:
        throw new Error('Job name no handler');
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(
    job: Job<SendConversationMessageDto | ConversationMessageDto>,
    result: Message,
  ) {
    if (job.name === 'send-message') {
      this.eventBus.publish(
        new ConversationMessageSentEvent(
          job.data as SendConversationMessageDto,
        ),
      );
    } else if (job.name === 'save-message') {
      this.eventBus.publish(new MessageSavedEvent(result, job.data.companyId));
    }
  }
}
