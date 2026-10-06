import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { CommandBus, EventBus } from '@nestjs/cqrs';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { SendAgentMessageCommand } from '../../integrations/whatsapp/commands/send-agent-message.command';
import { Message } from '../message/entities/message.entity';
import { ConversationsService } from './conversations.service';
import { ConversationMessageDto } from './dto/conversation-message.dto';
import { SendConversationMessageDto } from './dto/send-conversation-message.dto';
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

  /**
   * T5: an agent send is saved first as `pending` by the outbound pipeline,
   * which then waits for Graph's wamid before marking it `sent`. The job's
   * `attemptsMade` travels with the command so a stalled retry can finish a
   * row the dead attempt left pending.
   */
  sendMessageToWhatsapp(data: SendConversationMessageDto, attemptsMade = 0) {
    this.logger.debug('Execute send whatsapp client');
    return this.commandBus.execute(
      new SendAgentMessageCommand(data, attemptsMade),
    );
  }

  saveConversationMessage(
    data: SendConversationMessageDto | ConversationMessageDto,
  ) {
    return this.conversations.saveMsg(
      data.room,
      data.msg,
      data.sender,
      data.companyId,
    );
  }

  async process(job: Job<SendConversationMessageDto | ConversationMessageDto>) {
    switch (job.name) {
      case 'send-message':
        return await this.sendMessageToWhatsapp(
          job.data as SendConversationMessageDto,
          job.attemptsMade,
        );
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
    // T5: a send job no longer saves after Graph answers; the outbound
    // pipeline already persisted and broadcast the pending row.
    if (job.name === 'save-message') {
      this.eventBus.publish(new MessageSavedEvent(result, job.data.companyId));
    }
  }
}
