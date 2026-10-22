// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import { UpdateTaskSchema } from '@contracts';
import { createDatedZodDto } from '@docs/dated-zod-dto';

export class UpdateTaskDto extends createDatedZodDto(
  UpdateTaskSchema,
  UpdateTaskSchema.extend({ dueAt: z.iso.datetime().nullable().optional() }),
) {}
