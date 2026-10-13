// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Pure builders for the contracts snapshot.
 *
 * A snapshot is a plain-JSON description of every export in `src/contracts`,
 * grouped by source file. It is intentionally deterministic so a hash of it can
 * act as the "same contracts?" fingerprint shared between the API and the app.
 *
 * Determinism rules:
 * - Object keys are sorted recursively.
 * - `required` arrays (a set) are sorted, so reordering fields in a
 *   `z.object({...})` does NOT change the hash.
 * - Field renames / additions / removals / type changes DO change it.
 *
 * Only `zod` is imported here (the contracts folder stays framework-free); the
 * hashing and file I/O live in the generator script.
 */
import { z } from 'zod';

export type ContractExportPayload =
  | { kind: 'schema'; jsonSchema: unknown }
  | { kind: 'value'; value: unknown }
  | { kind: 'factory' };

export interface ContractSnapshot {
  contracts: Record<string, Record<string, ContractExportPayload>>;
}

/** A value is a Zod schema when it is an instance of `z.ZodType`. */
export function isZodSchema(value: unknown): value is z.ZodType {
  return value instanceof z.ZodType;
}

/**
 * Serializes a single export to its snapshot payload:
 * - Zod schema -> JSON Schema (`unrepresentable: 'any'` keeps coerce/preprocess
 *   from throwing; they degrade to `{}` instead).
 * - function (schema factory, e.g. `paginatedSchema`) -> `{ kind: 'factory' }`,
 *   so renames/additions are still detected even without a body.
 * - anything else (const objects/arrays) -> its raw value.
 */
export function toContractPayload(value: unknown): ContractExportPayload {
  if (typeof value === 'function') {
    return { kind: 'factory' };
  }

  if (isZodSchema(value)) {
    return {
      kind: 'schema',
      jsonSchema: z.toJSONSchema(value, { unrepresentable: 'any' }),
    };
  }

  return { kind: 'value', value };
}

/** Recursively sorts object keys and the `required` array of JSON Schemas. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }

    if (Array.isArray(sorted.required)) {
      sorted.required = [...(sorted.required as unknown[])].sort();
    }

    return sorted;
  }

  return value;
}

/**
 * Builds the snapshot from a map of `contractName -> moduleExports`.
 * `CONTRACT_MODULES` (registry) is the production input; tests inject fixtures.
 */
export function buildSnapshot(
  modules: Record<string, Record<string, unknown>>,
): ContractSnapshot {
  const contracts: Record<string, Record<string, ContractExportPayload>> = {};

  for (const name of Object.keys(modules).sort()) {
    const moduleExports = modules[name];
    const payloads: Record<string, ContractExportPayload> = {};

    for (const exportName of Object.keys(moduleExports).sort()) {
      payloads[exportName] = toContractPayload(moduleExports[exportName]);
    }

    contracts[name] = canonicalize(payloads) as Record<
      string,
      ContractExportPayload
    >;
  }

  return { contracts };
}

/** Stable textual form (2-space indent + trailing newline). */
export function serializeSnapshot(snapshot: ContractSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
