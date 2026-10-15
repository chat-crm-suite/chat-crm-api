// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';

import { CurrentTenant, Roles } from '../../auth/index';
import type { TenantContext } from '../../auth/index';
import {
  AgentControlParamsSchema,
  AgentControlQuerySchema,
  AgentControlSchema,
  AgentsPerformanceSchema,
  AnalyticsRangeQuerySchema,
  AnalyticsReadinessSchema,
  DeliverySchema,
  LiveQuerySchema,
  LiveSnapshotSchema,
  MyPerformanceSchema,
  PerformanceExportQuerySchema,
  SentimentAnalyticsQuerySchema,
  SentimentAnalyticsSchema,
  StaffingSchema,
  VolumeSchema,
} from '../../contracts/index';
import { zodResponseSchema } from '../../docs/zod-response';
import { AnalyticsService } from './analytics.service';

export class AnalyticsRangeQueryDto extends createZodDto(AnalyticsRangeQuerySchema) {}
export class LiveQueryDto extends createZodDto(LiveQuerySchema) {}
export class AgentControlParamsDto extends createZodDto(AgentControlParamsSchema) {}
export class AgentControlQueryDto extends createZodDto(AgentControlQuerySchema) {}
export class SentimentAnalyticsQueryDto extends createZodDto(SentimentAnalyticsQuerySchema) {}
export class PerformanceExportQueryDto extends createZodDto(PerformanceExportQuerySchema) {}

export class AnalyticsReadinessDto extends createZodDto(AnalyticsReadinessSchema) {}

/**
 * Role-shaped analytics of the active company. Agents: their own work and the
 * queue; supervisors: the floor and agents; admins: everything, including
 * company trends and the payroll export.
 */
@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('live')
  @ApiOperation({ summary: 'The floor right now (waiting customers, queue, agents)' })
  @ZodSerializerDto(LiveSnapshotSchema)
  @ApiOkResponse({ schema: zodResponseSchema(LiveSnapshotSchema) })
  live(@CurrentTenant() tenant: TenantContext, @Query() query: LiveQueryDto) {
    return this.analytics.live(tenant, query.channel);
  }

  @Get('me')
  @ApiOperation({ summary: 'Performance of the calling member vs the team median' })
  @ZodSerializerDto(MyPerformanceSchema)
  @ApiOkResponse({ schema: zodResponseSchema(MyPerformanceSchema) })
  me(@CurrentTenant() tenant: TenantContext, @Query() query: AnalyticsRangeQueryDto) {
    return this.analytics.me(tenant, query);
  }

  @Get('agents')
  @Roles('supervisor', 'admin')
  @ApiOperation({ summary: 'Performance of every agent (rates with intervals and shrinkage)' })
  @ZodSerializerDto(AgentsPerformanceSchema)
  @ApiOkResponse({ schema: zodResponseSchema(AgentsPerformanceSchema) })
  agents(@CurrentTenant() tenant: TenantContext, @Query() query: AnalyticsRangeQueryDto) {
    return this.analytics.agents(tenant, query);
  }

  @Get('agents/export.csv')
  @Roles('admin')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Monthly performance table as CSV' })
  async exportCsv(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: PerformanceExportQueryDto,
  ) {
    return this.analytics.exportCsv(tenant, query);
  }

  @Get('agents/:memberId/control')
  @ApiOperation({ summary: 'Daily control chart (XmR) of one agent metric' })
  @ZodSerializerDto(AgentControlSchema)
  @ApiOkResponse({ schema: zodResponseSchema(AgentControlSchema) })
  control(
    @CurrentTenant() tenant: TenantContext,
    @Param() params: AgentControlParamsDto,
    @Query() query: AgentControlQueryDto,
  ) {
    return this.analytics.control(tenant, params.memberId, query);
  }

  @Get('staffing')
  @Roles('supervisor', 'admin')
  @ApiOperation({ summary: 'Agents needed per hour (Erlang C) and arrivals heatmap' })
  @ZodSerializerDto(StaffingSchema)
  @ApiOkResponse({ schema: zodResponseSchema(StaffingSchema) })
  staffing(@CurrentTenant() tenant: TenantContext, @Query() query: LiveQueryDto) {
    return this.analytics.staffing(tenant, query.channel);
  }

  @Get('volume')
  @Roles('supervisor', 'admin')
  @ApiOperation({ summary: 'Cases, backlog and messages per day' })
  @ZodSerializerDto(VolumeSchema)
  @ApiOkResponse({ schema: zodResponseSchema(VolumeSchema) })
  volume(@CurrentTenant() tenant: TenantContext, @Query() query: AnalyticsRangeQueryDto) {
    return this.analytics.volume(tenant, query);
  }

  @Get('delivery')
  @Roles('admin')
  @ApiOperation({ summary: 'Outbound delivery health' })
  @ZodSerializerDto(DeliverySchema)
  @ApiOkResponse({ schema: zodResponseSchema(DeliverySchema) })
  delivery(@CurrentTenant() tenant: TenantContext, @Query() query: AnalyticsRangeQueryDto) {
    return this.analytics.delivery(tenant, query);
  }

  @Get('sentiment')
  @ApiOperation({ summary: 'Customer tone (409 ia_unavailable while the IA is off or down)' })
  @ZodSerializerDto(SentimentAnalyticsSchema)
  @ApiOkResponse({ schema: zodResponseSchema(SentimentAnalyticsSchema) })
  sentiment(@CurrentTenant() tenant: TenantContext, @Query() query: SentimentAnalyticsQueryDto) {
    return this.analytics.sentiment(tenant, query);
  }

  @Get('readiness')
  @ApiOperation({ summary: 'What a fresh install still needs before there is data' })
  @ZodSerializerDto(AnalyticsReadinessSchema)
  @ApiOkResponse({ type: AnalyticsReadinessDto })
  readiness(@CurrentTenant() tenant: TenantContext) {
    return this.analytics.readiness(tenant);
  }
}
