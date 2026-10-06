// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { dataTableBaseSchema } from "./data-table-base.schema";

const userFiltersShape = {
  username: z.string().optional(),
  phoneNumber: z.string().optional(),
  email: z.string().optional(),
  createdAt: z.string().optional(),
};

export const userTableQuerySchema = dataTableBaseSchema.extend(userFiltersShape);

/** Plain type (services/helpers) — object-literal types keep the index signature. */
export type UserTableQuery = z.infer<typeof userTableQuerySchema>;

/** Validation carrier for `@Body()` (global ZodValidationPipe). */
export class UserTableQueryDto extends createZodDto(userTableQuerySchema) {}
