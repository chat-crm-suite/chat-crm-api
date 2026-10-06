// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Default sales pipeline created for every new company (setup flow and
 * `POST /company`). Editable later through the API.
 */
export const DEFAULT_PIPELINE_STAGES: ReadonlyArray<{
  name: string;
  position: number;
  isWon?: boolean;
  isLost?: boolean;
}> = [
  { name: 'Nuevo', position: 0 },
  { name: 'Lead', position: 1 },
  { name: 'Prospecto', position: 2 },
  { name: 'Cliente', position: 3, isWon: true },
  { name: 'Perdido', position: 4, isLost: true },
];
