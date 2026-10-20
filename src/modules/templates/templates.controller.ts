// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';

import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { TenantContext } from '../../auth/auth.types';
import {
  SyncTemplatesResultSchema,
  TemplateGroupSchema,
  TemplateSchema,
} from '../../contracts/index';
import { zodResponseSchema } from '../../docs/zod-response';
import { SyncTemplatesDto } from './dto/sync-templates.dto';
import { TemplateListQueryDto } from './dto/template-list-query.dto';
import { UpdateTemplateSettingsDto } from './dto/update-template-settings.dto';
import { TemplatesService } from './templates.service';

/**
 * Provider templates of the company's channels. Any member reads (agents
 * only approved + visible ones); only admins sync or change settings.
 */
@ApiTags('Templates')
@ApiCookieAuth('access_token')
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'Templates of the company channels' })
  @ZodSerializerDto(TemplateSchema.array())
  @ApiOkResponse({ schema: zodResponseSchema(TemplateSchema.array()) })
  list(@Query() query: TemplateListQueryDto, @CurrentTenant() tenant: TenantContext) {
    return this.templates.list(tenant, query);
  }

  @Get('groups')
  @ApiOperation({ summary: 'Templates grouped by name across channels' })
  @ZodSerializerDto(TemplateGroupSchema.array())
  @ApiOkResponse({ schema: zodResponseSchema(TemplateGroupSchema.array()) })
  groups(@Query() query: TemplateListQueryDto, @CurrentTenant() tenant: TenantContext) {
    return this.templates.groups(tenant, query);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ApiOperation({ summary: "Pull a channel's templates from its provider" })
  @ZodSerializerDto(SyncTemplatesResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(SyncTemplatesResultSchema) })
  sync(@Body() body: SyncTemplatesDto, @CurrentTenant() tenant: TenantContext) {
    return this.templates.sync(tenant.companyId, body.channelId);
  }

  @Patch(':id/settings')
  @Roles('admin')
  @ApiOperation({ summary: 'CRM-side template settings (visibility, labels)' })
  @ZodSerializerDto(TemplateSchema)
  @ApiOkResponse({ schema: zodResponseSchema(TemplateSchema) })
  updateSettings(
    @Param('id') id: string,
    @Body() body: UpdateTemplateSettingsDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.templates.updateSettings(tenant.companyId, id, body);
  }
}
