// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { Channel } from './entities/channel.entity';
import { MessageTemplate } from './entities/message-template.entity';
import { ChannelAdapterRegistry } from './ports/channel-adapter.registry';
import { ChannelPricingRegistry } from './ports/channel-pricing.registry';
import { WhatsAppConnectionTester } from './whatsapp-connection.tester';
import { MetaCredentialsProbe } from '../setup/meta-credentials.probe';

@Module({
  imports: [TypeOrmModule.forFeature([Channel, MessageTemplate])],
  controllers: [ChannelsController],
  providers: [
    ChannelsService,
    ChannelAdapterRegistry,
    ChannelPricingRegistry,
    MetaCredentialsProbe,
    WhatsAppConnectionTester,
  ],
  exports: [ChannelsService, ChannelAdapterRegistry, ChannelPricingRegistry],
})
export class ChannelsModule {}
