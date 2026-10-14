// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, Optional } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';

import type { IaStatus } from '@contracts';
import { IaStatusChangedEvent } from '../../analytics/events/analytics.events';
import { CircuitBreakerService } from './circuit-breaker.service';
import { KillSwitchService } from './kill-switch.service';

/**
 * Whether sentiment features should render: the kill switch is on and the
 * circuit breaker is not open. Both reads fail open (enabled / closed), the
 * same safe defaults the analysis pipeline uses.
 */
@Injectable()
export class IaStatusService {
  constructor(
    private readonly killSwitch: KillSwitchService,
    private readonly breaker: CircuitBreakerService,
    @Optional() private readonly eventBus?: EventBus,
  ) {}

  async status(): Promise<IaStatus> {
    const [enabled, breaker] = await Promise.all([
      this.killSwitch.isEnabled(),
      this.breaker.getState(),
    ]);

    return toIaStatus(enabled, breaker);
  }

  /** Re-reads the state and announces it (toggle or breaker transition). */
  async announce(): Promise<void> {
    if (!this.eventBus) return;
    this.eventBus.publish(new IaStatusChangedEvent(await this.status()));
  }
}

export function toIaStatus(
  enabled: boolean,
  breaker: IaStatus['breaker'],
): IaStatus {
  const available = enabled && breaker !== 'open';
  return {
    status: !enabled ? 'disabled' : available ? 'active' : 'unavailable',
    enabled,
    available,
    breaker,
  };
}
