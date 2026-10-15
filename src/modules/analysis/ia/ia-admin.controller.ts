// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';

import { IaStateSchema } from '@contracts';
import { ToggleIaDto } from './dto/toggle-ia.dto';
import { IaAdminService } from './ia-admin.service';

/**
 * T2: manual kill switch endpoint. Protected with the existing privileged
 * pattern (JWT + active company context) and restricted to company admins
 * inside `IaAdminService`.
 */
@ApiTags('Admin')
@ApiCookieAuth('access_token')
@Controller('admin/ia')
export class IaAdminController {
  constructor(private readonly service: IaAdminService) {}

  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Turn the sentiment IA on or off at runtime' })
  @ZodSerializerDto(IaStateSchema)
  toggle(@Body() dto: ToggleIaDto) {
    return this.service.toggle(dto.enabled);
  }
}
