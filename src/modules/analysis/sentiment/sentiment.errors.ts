// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * T1: IA failure classification. Transport errors (timeout, refused
 * connection, DNS/network) and 5xx responses mean the IA is unavailable — an
 * expected condition: the analysis is `skipped` with reason `ia_unavailable`
 * and logged at info. Anything else (4xx, malformed payloads, bugs) is a real
 * failure: the analysis is `failed` and logged at error.
 */
const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ERR_NETWORK',
]);

export function isIaUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const response = (error as { response?: unknown }).response;
  if (typeof response === 'object' && response !== null) {
    const status = (response as { status?: unknown }).status;
    if (typeof status === 'number') return status >= 500;
  }

  const { code, name } = error as { code?: unknown; name?: unknown };
  if (typeof code === 'string' && UNAVAILABLE_CODES.has(code.toUpperCase())) {
    return true;
  }

  return name === 'TimeoutError';
}

/** The IA answered, but not with the agreed payload shape. */
export class IaContractError extends Error {
  constructor(message = 'Unexpected IA response') {
    super(message);
    this.name = IaContractError.name;
  }
}
