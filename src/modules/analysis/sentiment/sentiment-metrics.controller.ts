// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get } from '@nestjs/common';

import { SentimentMetricsService } from './sentiment-metrics.service';
import { Public } from '@auth';

/**
 * T6: `GET /metrics` — internal operational snapshot of the sentiment
 * pipeline (counters, IA latency, breaker state, retry backlog), exposed like
 * `/health`: no guards and no auth, counters only, never tenant or message
 * data.
 */
@Public()
@Controller('metrics')
export class SentimentMetricsController {
  constructor(private readonly service: SentimentMetricsService) {}

  @Get()
  snapshot() {
    return this.service.snapshot();
  }
}
