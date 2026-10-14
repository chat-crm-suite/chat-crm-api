// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createZodDto } from 'nestjs-zod';

import {
  PlatformCompanyQuerySchema,
  PlatformCompanyRowSchema,
  PlatformCompanyTableResponseSchema,
  PlatformCreateCompanyResultSchema,
  PlatformCreateCompanySchema,
  PlatformDeleteCompanyResultSchema,
  PlatformStatusSchema,
  PlatformUnlockSchema,
  PlatformUpdateCompanySchema,
} from '@contracts';

export class PlatformUnlockDto extends createZodDto(PlatformUnlockSchema) {}
export class PlatformStatusDto extends createZodDto(PlatformStatusSchema) {}
export class PlatformCompanyQueryDto extends createZodDto(PlatformCompanyQuerySchema) {}
export class PlatformCompanyRowDto extends createZodDto(PlatformCompanyRowSchema) {}
export class PlatformCompanyTableDto extends createZodDto(
  PlatformCompanyTableResponseSchema,
) {}
export class PlatformCreateCompanyDto extends createZodDto(PlatformCreateCompanySchema) {}
export class PlatformCreateCompanyResultDto extends createZodDto(
  PlatformCreateCompanyResultSchema,
) {}
export class PlatformUpdateCompanyDto extends createZodDto(PlatformUpdateCompanySchema) {}
export class PlatformDeleteCompanyResultDto extends createZodDto(
  PlatformDeleteCompanyResultSchema,
) {}
