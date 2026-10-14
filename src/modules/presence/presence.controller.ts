// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';

import { CurrentTenant } from '../../auth/index';
import type { TenantContext } from '../../auth/index';
import { PresenceSchema, UpdatePresenceSchema } from '../../contracts/index';
import { zodResponseSchema } from '../../docs/zod-response';
import { PresenceService } from './presence.service';

export class UpdatePresenceDto extends createZodDto(UpdatePresenceSchema) {}

/** The calling member's own presence in the active company. */
@ApiTags('Presence')
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current presence of the calling member' })
  @ZodSerializerDto(PresenceSchema)
  @ApiOkResponse({ schema: zodResponseSchema(PresenceSchema) })
  me(@CurrentTenant() tenant: TenantContext) {
    return this.presence.get(tenant.memberId);
  }

  @Put()
  @ApiOperation({ summary: 'Set the calling member as available or away' })
  @ZodSerializerDto(PresenceSchema)
  @ApiOkResponse({ schema: zodResponseSchema(PresenceSchema) })
  update(@Body() body: UpdatePresenceDto, @CurrentTenant() tenant: TenantContext) {
    return this.presence.setState(tenant.companyId, tenant.memberId, body.state);
  }
}
