// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { AnalysisModule } from './analysis/analysis.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { CasesModule } from './cases/cases.module';
import { ChannelsModule } from './channels/channels.module';
import { CompanyModule } from './company/company.module';
import { CompanyMembersModule } from './company-members/company-members.module';
import { ContractsModule } from './contracts/contracts.module';
import { ConversationsModule } from './conversations/conversations.module';
import { CustomersModule } from './customers/customers.module';
import { MessageModule } from './message/message.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PresenceModule } from './presence/presence.module';
import { SetupModule } from './setup/setup.module';
import { SpendModule } from './spend/spend.module';
import { UsersModule } from './users/users.module';

export {
  AnalysisModule,
  AnalyticsModule,
  AttachmentsModule,
  CasesModule,
  ChannelsModule,
  CompanyModule,
  CompanyMembersModule,
  ContractsModule,
  ConversationsModule,
  CustomersModule,
  MessageModule,
  NotificationsModule,
  PresenceModule,
  SetupModule,
  SpendModule,
  UsersModule,
};

export const modules = [
  AnalysisModule,
  AnalyticsModule,
  AttachmentsModule,
  CasesModule,
  ChannelsModule,
  CompanyModule,
  CompanyMembersModule,
  ContractsModule,
  ConversationsModule,
  CustomersModule,
  MessageModule,
  NotificationsModule,
  PresenceModule,
  SetupModule,
  SpendModule,
  UsersModule,
];

@Module({
  imports: modules,
  exports: modules,
})
export class CoreModules {}
