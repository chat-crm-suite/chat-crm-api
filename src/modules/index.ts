import { Module } from '@nestjs/common';
import { AnalysisModule } from './analysis/analysis.module';
import { ChannelsModule } from './channels/channels.module';
import { CompanyModule } from './company/company.module';
import { CompanyMembersModule } from './company-members/company-members.module';
import { ConversationsModule } from './conversations/conversations.module';
import { CustomersModule } from './customers/customers.module';
import { MessageModule } from './message/message.module';
import { MetricsModule } from './metrics/metrics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SetupModule } from './setup/setup.module';
import { UsersModule } from './users/users.module';

export {
  AnalysisModule,
  ChannelsModule,
  CompanyModule,
  CompanyMembersModule,
  ConversationsModule,
  CustomersModule,
  MessageModule,
  MetricsModule,
  NotificationsModule,
  SetupModule,
  UsersModule,
};

export const modules = [
  AnalysisModule,
  ChannelsModule,
  CompanyModule,
  CompanyMembersModule,
  ConversationsModule,
  CustomersModule,
  MessageModule,
  MetricsModule,
  NotificationsModule,
  SetupModule,
  UsersModule,
];

@Module({
  imports: modules,
  exports: modules,
})
export class CoreModules {}
