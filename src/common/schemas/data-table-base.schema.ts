// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from "zod";

const sortItemSchema = z.object({
  id: z.string(),
  desc: z.boolean().default(false),
});

export const dataTableBaseSchema = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).default(10),

  sort: z.array(sortItemSchema).optional().default([]),
});