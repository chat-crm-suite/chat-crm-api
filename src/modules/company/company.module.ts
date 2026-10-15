// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { Company } from './entities/company.entity';
import { CompanySettings } from './entities/company-settings.entity';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { ServiceSettingsModule } from './service-settings/service-settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Company, CompanySettings, CompanyMember]),
    ServiceSettingsModule,
  ],
  controllers: [CompanyController],
  providers: [CompanyService],
})
export class CompanyModule {}
