// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get, HttpCode, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MetricsService } from './metrics.service';
import { type AuthUser, CurrentUser } from '../../auth/index';
import { CompareQuery } from './dtos/queries/compare-query.dto';
import { SentimentTopQuery } from './dtos/queries/sentiment-top.query.dto';
import { CompareParams } from './dtos/params/compare.params.dto';
import { SentimentTrendQuery } from './dtos/queries/sentiment-trend.query.dto';

@Controller('metrics')
@UseGuards(AuthGuard('jwt'))
export class MetricsController {
  constructor(private readonly service: MetricsService) { }

  @Get('sentiment/top')
  async sentimentTop(@Query() query: SentimentTopQuery) {
    return this.service.getSentimentTop(query.actor, query.type, query.limit);
  }

  @Get(':metric/compare')
  async metricCompare(@Param() { metric }: CompareParams, @Query() { period }: CompareQuery) {
    return this.service.getComparePeriod(metric, period);
  }

  @Get("sentiment/trend")
  @HttpCode(HttpStatus.OK)
  async getSentimentTrend(@Query() { period }: SentimentTrendQuery) {
    return this.service.getTrendPeriod(period);
  }

  @Get("top-contacts")
  @HttpCode(HttpStatus.OK)
  async getTopContacts() {
    return this.service.getTopContacts();
  }

  @Get("best-agents")
  @HttpCode(HttpStatus.OK)
  async getBestAgents() {
    return this.service.getAgentsFast('POS');
  }

  @Get("bad-agents")
  @HttpCode(HttpStatus.OK)
  async getBadAgents() {
    return this.service.getAgentsFast('NEG');
  }

  @Get("best-clients")
  @HttpCode(HttpStatus.OK)
  async getBestClients(@CurrentUser('id') userId: AuthUser['id']) {
    return this.service.getBestClients(userId);
  }
}
