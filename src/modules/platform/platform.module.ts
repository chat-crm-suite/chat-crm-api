// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Company } from '../company/entities/company.entity';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { CompanyMembersModule } from '../company-members/company-members.module';
import { User } from '../users/entities/user.entity';
import { PlatformCompaniesController } from './platform-companies.controller';
import { PlatformCompaniesService } from './platform-companies.service';
import { PlatformRateLimiter } from './platform-rate-limiter';
import { PlatformTokenService } from './platform-token.service';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';
import { PlatformService } from './platform.service';

/**
 * Superadmin console (`/platform/*`): off unless `PLATFORM_CONSOLE_PASSWORD`
 * is set; platform admins unlock it with that password and manage companies.
 * The token is signed by a bare `JwtService` (the key is passed per call,
 * derived from `JWT_SECRET`), so it never shares configuration with the
 * access token.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Company, CompanyMember]),
    JwtModule.register({}),
    CompanyMembersModule,
  ],
  controllers: [PlatformController, PlatformCompaniesController],
  providers: [
    PlatformService,
    PlatformCompaniesService,
    PlatformTokenService,
    PlatformRateLimiter,
    PlatformGuard,
  ],
})
export class PlatformModule {}
