// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Case } from '../cases/entities/case.entity';
import { ChannelsModule } from '../channels/channels.module';
import { CompanySettings } from '../company/entities/company-settings.entity';
import { ServiceSettingsModule } from '../company/service-settings/service-settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingController } from './billing.controller';
import { ChannelCharge } from './entities/channel-charge.entity';
import { ChannelRate } from './entities/channel-rate.entity';
import { ChannelStatusReportedHandler } from './spend.events-handler';
import { SpendService } from './spend.service';

/**
 * Channel-agnostic spend: provider cost reports (through each channel's
 * pricing adapter), editable rates, budget alerts and the billable-send pause.
 */
@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([ChannelCharge, ChannelRate, CompanySettings, Case]),
    ChannelsModule,
    ServiceSettingsModule,
    NotificationsModule,
  ],
  controllers: [BillingController],
  providers: [SpendService, ChannelStatusReportedHandler],
  exports: [SpendService],
})
export class SpendModule {}
