// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createZodDto } from 'nestjs-zod';

import {
  PlatformCompanyQuerySchema,
  PlatformCreateCompanySchema,
  PlatformDeleteCompanyResultSchema,
  PlatformUnlockSchema,
  PlatformUpdateCompanySchema,
} from '@contracts';

export class PlatformUnlockDto extends createZodDto(PlatformUnlockSchema) {}
export class PlatformCompanyQueryDto extends createZodDto(PlatformCompanyQuerySchema) {}
export class PlatformCreateCompanyDto extends createZodDto(PlatformCreateCompanySchema) {}
export class PlatformUpdateCompanyDto extends createZodDto(PlatformUpdateCompanySchema) {}
export class PlatformDeleteCompanyResultDto extends createZodDto(
  PlatformDeleteCompanyResultSchema,
) {}
