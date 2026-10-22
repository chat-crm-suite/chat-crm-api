// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createZodDto } from 'nestjs-zod';

import { ListTasksQuerySchema } from '@contracts';

export class ListTasksQueryDto extends createZodDto(ListTasksQuerySchema) {}
