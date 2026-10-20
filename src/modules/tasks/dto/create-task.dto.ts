// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import { CreateTaskSchema } from '@contracts';
import { createDatedZodDto } from '@docs/dated-zod-dto';

export class CreateTaskDto extends createDatedZodDto(
  CreateTaskSchema,
  CreateTaskSchema.extend({ dueAt: z.iso.datetime().optional() }),
) {}
