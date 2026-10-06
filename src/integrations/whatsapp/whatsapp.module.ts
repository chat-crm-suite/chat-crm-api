import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChannelsModule } from '../../modules/channels/channels.module';
import { Channel } from '../../modules/channels/entities/channel.entity';
import { ConversationsModule } from '../../modules/conversations/conversations.module';
import { MessageModule } from '../../modules/message/message.module';
import { WhatsAppClient } from './clients/whatsapp.client';
import { MessageContentHandlers } from './commands/handlers/message-content.handlers';
import { ReceiveWhatsAppMessageHandler } from './commands/handlers/receive-whatsapp-message.handler';
import { SendAgentMessageHandler } from './commands/handlers/send-agent-message.handler';
import { SendWhatsAppMessageHandler } from './commands/handlers/send-whatsapp-message.handler';
import { WebhookController } from './controllers/index';
import { WhatsappInboundEvent } from './entities/whatsapp-inbound-event.entity';
import { InboundMediaEnrichmentHandler } from './intake/inbound-media-enrichment.handler';
import { InboundMediaEnrichmentService } from './intake/inbound-media-enrichment.service';
import { InboundMessageSavedHandler } from './intake/inbound-message-saved.handler';
import { WhatsAppInboundReplayService } from './intake/whatsapp-inbound-replay.service';
import { WhatsAppIntakeService } from './intake/whatsapp-intake.service';
import { AgentMessageSender } from './outbound/agent-message-sender.service';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [
    CqrsModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forFeature([Channel, WhatsappInboundEvent]),
    HttpModule,
    ChannelsModule,
    ConversationsModule,
    MessageModule,
  ],
  controllers: [WebhookController],
  providers: [
    WhatsAppService,
    AgentMessageSender,
    WhatsAppIntakeService,
    WhatsAppInboundReplayService,
    InboundMessageSavedHandler,
    InboundMediaEnrichmentService,
    InboundMediaEnrichmentHandler,
    WhatsAppClient,
    ReceiveWhatsAppMessageHandler,
    MessageContentHandlers,
    SendAgentMessageHandler,
    SendWhatsAppMessageHandler,
  ],
  exports: [WhatsAppService],
})
export class WhatsappModule {}
