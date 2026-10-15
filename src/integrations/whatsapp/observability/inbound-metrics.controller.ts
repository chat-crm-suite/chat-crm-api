// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get } from '@nestjs/common';

import { InboundMetricsService } from './inbound-metrics.service';
import { Public } from '@auth';

/**
 * Ticket #24: `GET /metrics/inbound` — internal operational snapshot of the
 * inbound pipeline (received/discarded/media counters plus queue-depth and
 * intake-backlog gauges). Exposed like `/metrics` and `/health`: no guards and
 * no auth, counters only, never tenant or message data.
 */
@Public()
@Controller('metrics/inbound')
export class InboundMetricsController {
  constructor(private readonly metrics: InboundMetricsService) {}

  @Get()
  snapshot() {
    return this.metrics.snapshot();
  }
}
