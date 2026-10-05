import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChannelsModule } from '../../modules/channels/channels.module';
import { Channel } from '../../modules/channels/entities/channel.entity';
import { ConversationsModule } from '../../modules/conversations/conversations.module';
import { WhatsAppClient } from './clients/whatsapp.client';
import { MessageContentHandlers } from './commands/handlers/message-content.handlers';
import { ReceiveWhatsAppMessageHandler } from './commands/handlers/receive-whatsapp-message.handler';
import { SendWhatsAppMessageHandler } from './commands/handlers/send-whatsapp-message.handler';
import { WebhookController } from './controllers/index';
import { WhatsappInboundEvent } from './entities/whatsapp-inbound-event.entity';
import { WhatsAppIntakeService } from './intake/whatsapp-intake.service';
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
  ],
  controllers: [WebhookController],
  providers: [
    WhatsAppService,
    WhatsAppIntakeService,
    WhatsAppClient,
    ReceiveWhatsAppMessageHandler,
    MessageContentHandlers,
    SendWhatsAppMessageHandler,
  ],
  exports: [WhatsAppService],
})
export class WhatsappModule {}
