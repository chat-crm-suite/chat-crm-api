// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';

import { CurrentUser, UserScoped } from '@auth';
import {
  PlatformCompanyRowSchema,
  PlatformCompanyTableResponseSchema,
  PlatformCreateCompanyResultSchema,
  PlatformDeleteCompanyResultSchema,
} from '@contracts';
import {
  PlatformCompanyQueryDto,
  PlatformCompanyRowDto,
  PlatformCompanyTableDto,
  PlatformCreateCompanyDto,
  PlatformCreateCompanyResultDto,
  PlatformDeleteCompanyResultDto,
  PlatformUpdateCompanyDto,
} from './dto/platform.dto';
import { PlatformCompaniesService } from './platform-companies.service';
import { PlatformGuard } from './platform.guard';

/**
 * Companies management for platform admins. All routes are `@UserScoped`
 * (no `x-company-id`) and sit behind `PlatformGuard`: an unlocked console,
 * not a company role, is what authorizes them.
 */
@ApiTags('Platform')
@ApiCookieAuth('access_token')
@UserScoped()
@UseGuards(PlatformGuard)
@Controller('platform/companies')
export class PlatformCompaniesController {
  constructor(private readonly companies: PlatformCompaniesService) {}

  @Post('table')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Companies table with member, customer and channel counts' })
  @ZodSerializerDto(PlatformCompanyTableResponseSchema)
  @ApiOkResponse({ type: PlatformCompanyTableDto })
  table(@Body() query: PlatformCompanyQueryDto) {
    return this.companies.table(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a company, optionally with its first admin' })
  @ZodSerializerDto(PlatformCreateCompanyResultSchema)
  @ApiOkResponse({ type: PlatformCreateCompanyResultDto })
  create(
    @Body() dto: PlatformCreateCompanyDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.companies.create(dto, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a company; a status change revokes its members sessions' })
  @ZodSerializerDto(PlatformCompanyRowSchema)
  @ApiOkResponse({ type: PlatformCompanyRowDto })
  update(
    @Param('id') id: string,
    @Body() dto: PlatformUpdateCompanyDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.companies.update(id, dto, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a company and revoke its members sessions' })
  @ZodSerializerDto(PlatformDeleteCompanyResultSchema)
  @ApiOkResponse({ type: PlatformDeleteCompanyResultDto })
  remove(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.companies.remove(id, userId);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted company' })
  @ZodSerializerDto(PlatformCompanyRowSchema)
  @ApiOkResponse({ type: PlatformCompanyRowDto })
  restore(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.companies.restore(id, userId);
  }
}
