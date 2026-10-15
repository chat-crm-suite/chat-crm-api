// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { CompanyMembersModule } from '../../company-members/company-members.module';
import {
  IA_CB_OPTIONS,
  readCircuitBreakerOptions,
} from './circuit-breaker.config';
import { CircuitBreakerService } from './circuit-breaker.service';
import { IaAdminController } from './ia-admin.controller';
import { IaAdminService } from './ia-admin.service';
import { IaStatusController } from './ia-status.controller';
import { IaStatusService } from './ia-status.service';
import { createIaRedis, IA_REDIS } from './ia-redis.provider';
import { KillSwitchService } from './kill-switch.service';

/**
 * T2/T3: IA availability controls. Provides the Redis-backed kill switch and
 * circuit breaker plus the admin endpoint that flips the switch; both services
 * are exported to the sentiment pipeline and the readiness probe.
 */
@Module({
  imports: [CompanyMembersModule],
  controllers: [IaAdminController, IaStatusController],
  providers: [
    {
      provide: IA_REDIS,
      useFactory: (logger: PinoLogger) => createIaRedis(logger),
      inject: [PinoLogger],
    },
    {
      provide: IA_CB_OPTIONS,
      useFactory: () => readCircuitBreakerOptions(),
    },
    KillSwitchService,
    CircuitBreakerService,
    IaAdminService,
    IaStatusService,
  ],
  exports: [IA_REDIS, KillSwitchService, CircuitBreakerService, IaStatusService],
})
export class IaModule {}
