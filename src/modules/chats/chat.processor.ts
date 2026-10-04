import { SendWhatsAppMessageCommand } from "../../integrations/whatsapp/commands/send-whatsapp-message.command";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { CommandBus, EventBus } from "@nestjs/cqrs";
import { Job } from "bullmq";
import { getMessageStrategy } from "../message/strategies/strategy.registry";
import { SendChatMessageDto } from "./dto/send-chat-message.dto";
import { ChatMessageSentEvent } from "./events/chat-message-sent.event";
import { ChatsService } from "./chats.service";
import { MessageSavedEvent } from "./events/message-saved.event";
import { Message } from "../../entities/index";
import { PinoLogger } from "nestjs-pino";
import { ChatMessageDto } from "./dto/chat-message.dto";

@Processor('chat')
export class ChatProcessor extends WorkerHost {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly eventBus: EventBus,
    private readonly chatService: ChatsService,
    private readonly logger: PinoLogger,
  ) { super(); this.logger.setContext(ChatProcessor.name) }

  sendMessageToWhatsapp(data: SendChatMessageDto) {
    this.logger.debug('Execute send whatsapp client')
    const strategy = getMessageStrategy(data.msg.type);
    try {
      const payload = strategy.toWhatsAppPayload(data.to, data.msg.content);
      void this.commandBus.execute(new SendWhatsAppMessageCommand(payload));
    } catch (e) {
      this.logger.error(e, 'hay error')
    }
  }

  saveChatMessage(data: SendChatMessageDto | ChatMessageDto) {
    return this.chatService.saveMsg(data.room, data.msg, data.sender);
  }

  async process(job: Job<SendChatMessageDto>): Promise<any> {
    switch (job.name) {
      case 'send-message': {
        this.sendMessageToWhatsapp(job.data);
        break;
      }
      case 'save-message':
        return await this.saveChatMessage(job.data);
      default:
        throw new Error('Job name no handler')
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<SendChatMessageDto | ChatMessageDto>, result: Message) {
    if (job.name === 'send-message') {
      this.eventBus.publish(new ChatMessageSentEvent(job.data))
    } else if (job.name === 'save-message') {
      this.eventBus.publish(new MessageSavedEvent(result, job.data.companyId))
    }
  }
}