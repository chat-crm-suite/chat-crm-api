// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createZodDto } from 'nestjs-zod';

import { UpdateAssignmentSettingsSchema } from '../../../contracts/index';

/**
 * Automatic assignment settings per company (Q18).
 * Only admins/managers of the company can change them.
 */
export class UpdateAssignmentSettingsDto extends createZodDto(
  UpdateAssignmentSettingsSchema,
) {}
