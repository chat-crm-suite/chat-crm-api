// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';

import { ChannelsModule } from '../../modules/channels/channels.module';
import { Channel } from '../../modules/channels/entities/channel.entity';
import { ConversationsModule } from '../../modules/conversations/conversations.module';
import { MessageModule } from '../../modules/message/message.module';
import { WhatsAppClient } from './clients/whatsapp.client';
import { InboundMessageRouter } from './commands/router/inbound-message.router';
import { ReceiveWhatsAppMessageHandler } from './commands/handlers/receive-whatsapp-message.handler';
import { SendAgentMessageHandler } from './commands/handlers/send-agent-message.handler';
import { SendWhatsAppMessageHandler } from './commands/handlers/send-whatsapp-message.handler';
import { WebhookController } from './controllers/index';
import { InboundMetricsController } from './observability/inbound-metrics.controller';
import { WhatsappInboundEvent } from './entities/whatsapp-inbound-event.entity';
import { ENRICH_MEDIA_QUEUE } from './intake/enrich-media.queue';
import { EnrichMediaProcessor } from './intake/enrich-media.processor';
import { InboundMediaEnrichmentHandler } from './intake/inbound-media-enrichment.handler';
import { InboundMediaEnrichmentService } from './intake/inbound-media-enrichment.service';
import { InboundMessageSavedHandler } from './intake/inbound-message-saved.handler';
import { InboundWebhookParserService } from './intake/inbound-webhook-parser.service';
import { WhatsAppInboundReplayService } from './intake/whatsapp-inbound-replay.service';
import { WhatsAppIntakeService } from './intake/whatsapp-intake.service';
import {
  InboundDiscardLogHandler,
  InboundMediaEnrichedLogHandler,
  InboundMediaFailedLogHandler,
} from './observability/inbound-log.handlers';
import {
  createInboundMetricsRedis,
  INBOUND_METRICS_REDIS,
} from './observability/inbound-metrics.redis';
import { InboundMetricsService } from './observability/inbound-metrics.service';
import {
  InboundDiscardedMetricsHandler,
  InboundMediaEnrichedMetricsHandler,
  InboundMediaFailedMetricsHandler,
  InboundReceivedMetricsHandler,
} from './observability/inbound-metrics.subscriber';
import { AgentMessageSender } from './outbound/agent-message-sender.service';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [
    CqrsModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forFeature([Channel, WhatsappInboundEvent]),
    BullModule.registerQueue({ name: ENRICH_MEDIA_QUEUE }),
    HttpModule,
    ChannelsModule,
    ConversationsModule,
    MessageModule,
  ],
  controllers: [WebhookController, InboundMetricsController],
  providers: [
    WhatsAppService,
    AgentMessageSender,
    WhatsAppIntakeService,
    WhatsAppInboundReplayService,
    InboundMessageSavedHandler,
    InboundWebhookParserService,
    InboundMediaEnrichmentService,
    InboundMediaEnrichmentHandler,
    EnrichMediaProcessor,
    WhatsAppClient,
    ReceiveWhatsAppMessageHandler,
    InboundMessageRouter,
    SendAgentMessageHandler,
    SendWhatsAppMessageHandler,
    // Ticket #24: event-based observability (logs + metrics).
    {
      provide: INBOUND_METRICS_REDIS,
      useFactory: (logger: PinoLogger) => createInboundMetricsRedis(logger),
      inject: [PinoLogger],
    },
    InboundMetricsService,
    InboundDiscardLogHandler,
    InboundMediaEnrichedLogHandler,
    InboundMediaFailedLogHandler,
    InboundReceivedMetricsHandler,
    InboundDiscardedMetricsHandler,
    InboundMediaEnrichedMetricsHandler,
    InboundMediaFailedMetricsHandler,
  ],
  exports: [WhatsAppService],
})
export class WhatsappModule {}
