// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ApiResponseSchemaHost } from '@nestjs/swagger';
import { z } from 'zod';

type SchemaObject = ApiResponseSchemaHost['schema'];

/**
 * OpenAPI schema of a response contract that carries dates. `createZodDto`
 * cannot describe `z.coerce.date()` (JSON Schema has no Date), so these
 * endpoints document their payload with this instead: dates are emitted as
 * ISO strings on the wire, so they are described as `date-time` strings.
 */
export function zodResponseSchema(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, {
    io: 'output',
    unrepresentable: 'any',
    override: (ctx) => {
      if (ctx.zodSchema._zod.def.type === 'date') {
        ctx.jsonSchema.type = 'string';
        ctx.jsonSchema.format = 'date-time';
      }
    },
  }) as SchemaObject;
}
