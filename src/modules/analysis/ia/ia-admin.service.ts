// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import type { IaState } from '@contracts';
import { CompanyMemberService } from '../../company-members/company-member.service';
import { IaStatusChangedEvent } from '../../analytics/events/analytics.events';
import { CircuitBreakerService } from './circuit-breaker.service';
import { toIaStatus } from './ia-status.service';
import { KillSwitchService } from './kill-switch.service';

/**
 * T2: privileged side of the manual kill switch. Reuses the existing
 * privileged-endpoint pattern — JWT plus the active company context — and
 * additionally requires an active `admin` membership in that company. The
 * toggle is persisted in Redis and logged with its resolved state.
 */
@Injectable()
export class IaAdminService {
  constructor(
    private readonly killSwitch: KillSwitchService,
    private readonly members: CompanyMemberService,
    private readonly logger: PinoLogger,
    @Optional() private readonly breaker?: CircuitBreakerService,
    @Optional() private readonly eventBus?: EventBus,
  ) {
    this.logger.setContext(IaAdminService.name);
  }

  async toggle(enabled: boolean): Promise<IaState> {
    const member = await this.members.getMemberActive();

    if (member?.role !== 'admin' || member.status !== 'active') {
      throw new ForbiddenException(
        'Only company admins can toggle the IA kill switch',
      );
    }

    try {
      const state = await this.killSwitch.setEnabled(enabled);

      this.logger.info(
        {
          enabled: state,
          userId: member.userId,
          companyId: member.companyId,
        },
        'IA kill switch toggled',
      );

      if (this.eventBus) {
        const breaker = (await this.breaker?.getState()) ?? 'closed';
        this.eventBus.publish(new IaStatusChangedEvent(toIaStatus(state, breaker)));
      }

      return { enabled: state };
    } catch (err: unknown) {
      this.logger.error(
        { err, enabled },
        'Failed to persist the IA kill switch',
      );
      throw err;
    }
  }
}
