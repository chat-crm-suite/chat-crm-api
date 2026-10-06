// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from "zod";

/**
 * Zod transformer that converts a comma-separated string into an array of strings.
 * If the string is empty or null, it returns undefined.
 * If it doesn't contain commas, it returns the original string.
 */
export const commaSeparatedStringTransformer = z.string().optional().transform((val) => {
  if (!val) {
    return undefined;
  }

  // If it contains a comma, split into an array. Otherwise, return the string.
  return val.includes(',') ? val.split(',') : val;
});
