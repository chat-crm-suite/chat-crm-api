// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createZodDto } from 'nestjs-zod';
import type { z } from 'zod';

interface OpenApiDto {
  _OPENAPI_METADATA_FACTORY(): unknown;
}

/**
 * `createZodDto` for request contracts with `z.coerce.date()` fields, which
 * JSON Schema cannot describe. Validation still runs on `schema`; OpenAPI is
 * generated from `docs`, the same shape with those dates as ISO strings
 * (what clients send on the wire).
 */
export function createDatedZodDto<S extends z.ZodObject>(schema: S, docs: z.ZodObject) {
  const Dto = createZodDto(schema);
  const Docs = createZodDto(docs) as unknown as OpenApiDto;
  Object.defineProperty(Dto, '_OPENAPI_METADATA_FACTORY', {
    value: () => Docs._OPENAPI_METADATA_FACTORY(),
  });

  return Dto;
}
