import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatsService } from './chats.service';
import { ChatsController, MessagesController } from './controllers/index';
import { Chat, ChatAssignments, Transfer } from './entities/index';
import { Contact } from '../contacts/entities/contact.entity';
import { User } from '../users/entities/user.entity';
import { Company } from '../company/entities/company.entity';
import { Member } from '../member/member.entity';
import { MessageModule } from '../message/message.module';
import { ChatGateway } from './gateways/chat.gateway';
import { SentimentModule } from '../analysis/sentiment/sentiment.module';
import { ChatSaga } from './chat.saga';
import { ChatRepository } from './chat.repository';
import { ChatAssignmentService } from './assignment/chat-assignment.service';
import { ChatAssignmentNotifier } from './assignment/chat-assignment.notifier';
import { NotificationsModule } from '../notifications/notifications.module';
import { BullModule } from '@nestjs/bullmq';
import { ChatProcessor } from './chat.processor';
import { CqrsModule } from '@nestjs/cqrs';
import {
  BroadcastChatMessageHandler,
  ClaimChatHandler,
  EnsureChatAssignedHandler,
  SaveChatMessageHandler,
  SendChatMessageHandler,
  UpdateSentimentIndicatorHandler,
  FailWhatsAppMessageHandler
} from './commands/handlers/index';

const TypeOrmFeatureModule = TypeOrmModule.forFeature([
  Chat,
  ChatAssignments,
  Company,
  Contact,
  Member,
  Transfer,
  User,
]);
const handlers = [
  BroadcastChatMessageHandler,
  ClaimChatHandler,
  EnsureChatAssignedHandler,
  SaveChatMessageHandler,
  SendChatMessageHandler,
  UpdateSentimentIndicatorHandler,
  FailWhatsAppMessageHandler,
];

@Module({
  imports: [
    CqrsModule,
    TypeOrmFeatureModule,
    MessageModule,
    NotificationsModule,
    SentimentModule,
    BullModule.registerQueue({
      name: 'chat',
    }),
  ],
  controllers: [ChatsController, MessagesController],
  providers: [
    ChatsService, ChatGateway,
    ChatSaga, ChatRepository,
    ChatAssignmentService,
    ChatAssignmentNotifier,
    ChatProcessor,
    ...handlers
  ],
  exports: [ChatRepository, ChatsService]
})
export class ChatsModule { }
