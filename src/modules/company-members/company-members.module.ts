// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module';
import { CompanyMemberController } from './company-member.controller';
import { CompanyMemberService } from './company-member.service';
import { CompanyMember } from './entities/company-member.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CompanyMember]), UsersModule],
  providers: [CompanyMemberService],
  exports: [CompanyMemberService],
  controllers: [CompanyMemberController],
})
export class CompanyMembersModule {}
