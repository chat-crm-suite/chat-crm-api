// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';

import { CurrentTenant, Roles } from '../../auth/index';
import {
  BillablePauseSchema,
  SpendQuerySchema,
  SpendSummarySchema,
  UpdateBudgetSchema,
  UpdateChannelRatesSchema,
} from '../../contracts/index';
import { SpendService } from './spend.service';

export class SpendQueryDto extends createZodDto(SpendQuerySchema) {}
export class UpdateChannelRatesDto extends createZodDto(UpdateChannelRatesSchema) {}
export class UpdateBudgetDto extends createZodDto(UpdateBudgetSchema) {}
export class BillablePauseDto extends createZodDto(BillablePauseSchema) {}
export class SpendSummaryResponseDto extends createZodDto(SpendSummarySchema) {}

/**
 * Channel spend for company admins: the month summary and its controls.
 * Every mutation answers the refreshed summary of the current month.
 */
@ApiTags('Billing')
@Roles('admin')
@Controller('billing')
export class BillingController {
  constructor(private readonly spend: SpendService) {}

  @Get('spend')
  @ApiOperation({ summary: 'Channel spend of a month (approximate, USD)' })
  @ZodSerializerDto(SpendSummarySchema)
  @ApiOkResponse({ type: SpendSummaryResponseDto })
  summary(@CurrentTenant('companyId') companyId: string, @Query() query: SpendQueryDto) {
    return this.spend.summary(companyId, query.month);
  }

  @Put('rates')
  @ApiOperation({ summary: 'Set the price per billable unit by channel and category' })
  @ZodSerializerDto(SpendSummarySchema)
  @ApiOkResponse({ type: SpendSummaryResponseDto })
  async rates(@CurrentTenant('companyId') companyId: string, @Body() body: UpdateChannelRatesDto) {
    await this.spend.updateRates(companyId, body.rates);
    return this.spend.summary(companyId);
  }

  @Put('budget')
  @ApiOperation({ summary: 'Set (or remove) the monthly spend budget' })
  @ZodSerializerDto(SpendSummarySchema)
  @ApiOkResponse({ type: SpendSummaryResponseDto })
  async budget(@CurrentTenant('companyId') companyId: string, @Body() body: UpdateBudgetDto) {
    await this.spend.updateBudget(companyId, body.monthlyBudgetUsd);
    return this.spend.summary(companyId);
  }

  @Post('pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause or resume billable outbound sends' })
  @ZodSerializerDto(SpendSummarySchema)
  @ApiOkResponse({ type: SpendSummaryResponseDto })
  async pause(@CurrentTenant('companyId') companyId: string, @Body() body: BillablePauseDto) {
    await this.spend.setPaused(companyId, body.paused);
    return this.spend.summary(companyId);
  }
}
