// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompanySettings } from '../entities/company-settings.entity';
import { Company } from '../entities/company.entity';
import { ServiceSettingsService } from './service-settings.service';

/**
 * Business hours + SLA reader/writer, kept apart from `CompanyModule` so the
 * analytics and spend modules can depend on it without the company admin
 * surface (and its auth dependencies).
 */
@Module({
  imports: [TypeOrmModule.forFeature([CompanySettings, Company])],
  providers: [ServiceSettingsService],
  exports: [ServiceSettingsService],
})
export class ServiceSettingsModule {}
