// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z, ZodRawShape } from "zod";
import { dataTableBaseSchema } from "./data-table-base.schema";

/**
 * Creates a table query schema by merging the strict base schema with custom filters,
 * and applies a final transformation to convert comma-separated strings into arrays.
 */
export function createTableQuerySchema<T extends ZodRawShape>(
  customFiltersShape: T,
) {
  const customFiltersSchema = z.object(customFiltersShape);

  const mergedSchema = dataTableBaseSchema.extend(customFiltersSchema.shape);

  // FINAL TRANSFORMATION (applies array/string logic only)
  const finalSchema = mergedSchema.transform((data) => {
    const transformed: Record<string, any> = { ...data };

    for (const [key, value] of Object.entries(data)) {
      // Skip base fields already transformed or non-string values
      if (['page', 'perPage', 'sort'].includes(key) || typeof value !== 'string') {
        continue;
      }

      // Apply comma-splitting for filter fields (e.g., status, assignedTo)
      if (value.includes(',')) {
        transformed[key] = value.split(',');
      }
    }

    return transformed;
  });

  return finalSchema;
}
