// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { CompanyMembersModule } from '../../company-members/company-members.module';
import { IaAdminController } from './ia-admin.controller';
import { IaAdminService } from './ia-admin.service';
import { createIaRedis, IA_REDIS } from './ia-redis.provider';
import { KillSwitchService } from './kill-switch.service';

/**
 * T2: IA availability controls. Provides the Redis-backed kill switch (and,
 * in later tickets, the circuit breaker) plus the admin endpoint that flips
 * it; `KillSwitchService` is exported to the sentiment pipeline and the
 * readiness probe.
 */
@Module({
  imports: [CompanyMembersModule],
  controllers: [IaAdminController],
  providers: [
    {
      provide: IA_REDIS,
      useFactory: (logger: PinoLogger) => createIaRedis(logger),
      inject: [PinoLogger],
    },
    KillSwitchService,
    IaAdminService,
  ],
  exports: [KillSwitchService],
})
export class IaModule {}
