// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Channel } from '../channels/entities/channel.entity';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { CompanySettings } from '../company/entities/company-settings.entity';
import { Company } from '../company/entities/company.entity';
import { PipelineStage } from '../customers/entities/pipeline-stage.entity';
import { User } from '../users/entities/user.entity';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Company,
      CompanyMember,
      Channel,
      CompanySettings,
      PipelineStage,
    ]),
  ],
  controllers: [SetupController],
  providers: [SetupService],
  exports: [SetupService],
})
export class SetupModule {}
