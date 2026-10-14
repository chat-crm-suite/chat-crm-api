// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkspaceTableCache } from '../../common/cache/workspace-table-cache.service';
import { ConversationAssignmentService } from '../conversations/assignment/conversation-assignment.service';
import { PresenceModule } from '../presence/presence.module';
import { UsersModule } from '../users/users.module';
import { CompanyMemberController } from './company-member.controller';
import { CompanyMemberService } from './company-member.service';
import { MemberProvisioningService } from './member-provisioning.service';
import { CompanyMember } from './entities/company-member.entity';

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([CompanyMember]),
    UsersModule,
    PresenceModule,
  ],
  providers: [
    CompanyMemberService,
    MemberProvisioningService,
    // Not the ConversationsModule: it reaches this module through IaModule.
    // The service only needs the DataSource and the logger, so it is provided
    // here directly to release a removed member's conversations.
    ConversationAssignmentService,
    WorkspaceTableCache,
  ],
  exports: [CompanyMemberService, MemberProvisioningService],
  controllers: [CompanyMemberController],
})
export class CompanyMembersModule {}
