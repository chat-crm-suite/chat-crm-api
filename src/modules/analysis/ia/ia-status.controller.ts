// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';

import { IaStatusSchema } from '@contracts';
import { IaStatusService } from './ia-status.service';

export class IaStatusResponseDto extends createZodDto(IaStatusSchema) {}

/** Readable by any member: the UI hides tone features while unavailable. */
@ApiTags('IA')
@Controller('ia')
export class IaStatusController {
  constructor(private readonly status: IaStatusService) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether the sentiment IA is enabled and reachable' })
  @ZodSerializerDto(IaStatusSchema)
  @ApiOkResponse({ type: IaStatusResponseDto })
  get() {
    return this.status.status();
  }
}
