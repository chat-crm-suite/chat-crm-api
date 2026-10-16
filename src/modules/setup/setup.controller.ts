// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import { ZodValidationPipe } from 'nestjs-zod';

import {
  ValidateSetupStepSchema,
  type ValidateSetupStepInput,
} from '@contracts';
import { CreateSetupDto } from './dto/create-setup.dto';
import { SetupService } from './setup.service';
import { Public } from '@auth';

/**
 * Endpoints públicos de primer arranque. Deliberadamente sin guardas: son la
 * vía de entrada cuando todavía no existe ningún usuario/empresa. `POST` queda
 * bloqueado por el servicio (409) en cuanto la app está inicializada.
 */
@Public()
@Controller('setup')
export class SetupController {
  constructor(private readonly service: SetupService) {}

  @Get('status')
  status() {
    return this.service.status();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  run(@Body() dto: CreateSetupDto) {
    return this.service.run(dto);
  }

  /** Validates one wizard step (token, admin, company, whatsapp) before moving on. */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validate(
    // A discriminated union cannot back a DTO class: validate with the
    // contract schema directly (same 400 envelope through the global filter).
    @Body(new ZodValidationPipe(ValidateSetupStepSchema))
    dto: ValidateSetupStepInput,
  ) {
    return this.service.validateStep(dto);
  }
}
