// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CqrsModule } from '@nestjs/cqrs';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { getJwtSecret } from '../../auth/jwt.config';
import { SentimentModule } from '../analysis/sentiment/sentiment.module';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { CustomersModule } from '../customers/customers.module';
import { MessageModule } from '../message/message.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PresenceModule } from '../presence/presence.module';
import { SpendModule } from '../spend/spend.module';
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
import { ConversationListService } from './listing/conversation-list.service';
import { ConversationAccessService } from './realtime/conversation-access.service';
import { ConversationFanoutService } from './realtime/conversation-fanout.service';
import { ConversationSendContextService } from './send-context/conversation-send-context.service';
import { ConversationSendGuard } from './outbound/conversation-send-guard.service';
import { ChannelStatusChangedHandler } from './realtime/channel-status-changed.handler';
import { AgentMessageSender } from './outbound/agent-message-sender.service';
import { OutgoingMediaService } from './outbound/outgoing-media.service';
import { ChannelsModule } from '../channels/channels.module';
import { MediaModule } from '../media/media.module';
import { ConversationUploadsService } from './uploads/conversation-uploads.service';
import { UserSessionsRevokedHandler } from './realtime/user-sessions-revoked.handler';
import { MemberConversationsReleasedHandler } from './realtime/member-conversations-released.handler';
import { WorkspaceChangedHandler } from './realtime/workspace-changed.handler';

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
    BullModule.registerQueue({
      name: 'chat',
      // Sends and saves are persisted as rows: finished jobs are only kept
      // for a recent look in Redis, never forever.
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    }),
    // Same secret as the HTTP auth layer: the socket verifies the existing
    // `access_token` cookie during the handshake.
    JwtModule.register({
      secret: getJwtSecret(),
    }),
    MessageModule,
    ChannelsModule,
    MediaModule,
    NotificationsModule,
    CustomersModule,
    SentimentModule,
    PresenceModule,
    SpendModule,
  ],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    ConversationRepository,
    ConversationGateway,
    ConversationAccessService,
    ConversationFanoutService,
    ConversationSendContextService,
    ConversationSendGuard,
    ChannelStatusChangedHandler,
    ConversationListService,
    AgentMessageSender,
    OutgoingMediaService,
    ConversationUploadsService,
    ConversationAssignmentService,
    ConversationAssignmentNotifier,
    ConversationProcessor,
    ConversationSaga,
    UserSessionsRevokedHandler,
    WorkspaceChangedHandler,
    MemberConversationsReleasedHandler,
    ...commandHandlers,
  ],
  exports: [
    ConversationsService,
    ConversationRepository,
    ConversationAssignmentService,
    ConversationGateway,
    ConversationFanoutService,
    ConversationAccessService,
    ConversationSendContextService,
    ConversationSendGuard,
    ConversationListService,
    ConversationAssignmentNotifier,
    AgentMessageSender,
  ],
})
export class ConversationsModule {}
