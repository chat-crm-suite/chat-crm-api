import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CqrsModule } from '@nestjs/cqrs';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SentimentModule } from '../analysis/sentiment/sentiment.module';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { CustomersModule } from '../customers/customers.module';
import { MessageModule } from '../message/message.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConversationAssignmentService } from './assignment/conversation-assignment.service';
import { ConversationAssignmentNotifier } from './assignment/conversation-assignment.notifier';
import {
  BroadcastConversationMessageHandler,
  ClaimConversationHandler,
  EnsureConversationAssignedHandler,
  FailWhatsAppMessageHandler,
  SaveConversationMessageHandler,
  SendConversationMessageHandler,
  UpdateMessageStatusHandler,
  UpdateSentimentIndicatorHandler,
} from './commands/handlers';
import { ConversationProcessor } from './conversation.processor';
import { ConversationRepository } from './conversation.repository';
import { ConversationSaga } from './conversation.saga';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationAssignment } from './entities/conversation-assignment.entity';
import { Conversation } from './entities/conversation.entity';
import { ConversationGateway } from './gateways/conversation.gateway';
import { ConversationAccessService } from './realtime/conversation-access.service';
import { ConversationFanoutService } from './realtime/conversation-fanout.service';

const commandHandlers = [
  BroadcastConversationMessageHandler,
  ClaimConversationHandler,
  EnsureConversationAssignedHandler,
  FailWhatsAppMessageHandler,
  SaveConversationMessageHandler,
  SendConversationMessageHandler,
  UpdateMessageStatusHandler,
  UpdateSentimentIndicatorHandler,
];

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([
      Conversation,
      ConversationAssignment,
      CompanyMember,
    ]),
    BullModule.registerQueue({ name: 'chat' }),
    // Same secret as the HTTP auth layer: the socket verifies the existing
    // `access_token` cookie during the handshake.
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your_jwt_secret',
    }),
    MessageModule,
    NotificationsModule,
    CustomersModule,
    SentimentModule,
  ],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    ConversationRepository,
    ConversationGateway,
    ConversationAccessService,
    ConversationFanoutService,
    ConversationAssignmentService,
    ConversationAssignmentNotifier,
    ConversationProcessor,
    ConversationSaga,
    ...commandHandlers,
  ],
  exports: [
    ConversationsService,
    ConversationRepository,
    ConversationAssignmentService,
  ],
})
export class ConversationsModule {}
