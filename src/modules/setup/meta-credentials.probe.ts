// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';

import type { SetupStepError } from '@contracts';

/**
 * Always Meta's public host: the setup endpoint is public, so a client-chosen
 * base URL would let anyone make this server call arbitrary URLs (SSRF).
 */
const GRAPH_BASE_URL = 'https://graph.facebook.com';
const PROBE_TIMEOUT_MS = 8_000;

export interface MetaProbeInput {
  phoneNumberId: string;
  accessToken: string;
  appSecret?: string;
  apiVersion: string;
}

export type MetaProbeResult =
  | { kind: 'ok'; displayPhoneNumber: string | null; verifiedName: string | null }
  | { kind: 'invalid'; errors: SetupStepError[] }
  | { kind: 'unreachable'; reason: string };

interface GraphError {
  message?: string;
  code?: number;
  error_subcode?: number;
}

/**
 * Checks phone number ID + access token (+ App Secret, through
 * `appsecret_proof`) with ONE read-only Graph call:
 * `GET /{version}/{phoneNumberId}?fields=display_phone_number,verified_name`.
 * Graph rejects a wrong `appsecret_proof`, so the three values are proven
 * together. Nothing is written to Meta.
 */
@Injectable()
export class MetaCredentialsProbe {
  async probe(input: MetaProbeInput): Promise<MetaProbeResult> {
    const params = new URLSearchParams({
      fields: 'display_phone_number,verified_name',
    });
    if (input.appSecret) {
      params.set(
        'appsecret_proof',
        createHmac('sha256', input.appSecret)
          .update(input.accessToken)
          .digest('hex'),
      );
    }
    const url = `${GRAPH_BASE_URL}/${input.apiVersion}/${encodeURIComponent(input.phoneNumberId)}?${params.toString()}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${input.accessToken}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        kind: 'unreachable',
        reason: error instanceof Error ? error.message : 'network error',
      };
    }

    const body = (await response.json().catch(() => null)) as {
      display_phone_number?: string;
      verified_name?: string;
      error?: GraphError;
    } | null;

    if (response.ok && body && !body.error) {
      return {
        kind: 'ok',
        displayPhoneNumber: body.display_phone_number ?? null,
        verifiedName: body.verified_name ?? null,
      };
    }
    if (response.status >= 500) {
      return { kind: 'unreachable', reason: `Meta answered ${response.status}` };
    }
    return { kind: 'invalid', errors: [toFieldError(body?.error, !!input.appSecret)] };
  }
}

/** Maps a Graph error onto the wizard field the user has to fix. */
export function toFieldError(
  error: GraphError | undefined,
  sentAppSecret: boolean,
): SetupStepError {
  const message = error?.message ?? '';

  if (sentAppSecret && /appsecret_proof/i.test(message)) {
    return {
      path: 'whatsapp.appSecret',
      message: 'El App Secret no corresponde a la app de Meta de este token.',
    };
  }
  // 190: invalid/expired token. 10/200: token without WhatsApp permissions.
  if (error?.code === 190 || error?.code === 10 || error?.code === 200) {
    return {
      path: 'whatsapp.accessToken',
      message:
        error.code === 190
          ? 'Meta rechazó el access token (inválido o caducado).'
          : 'El access token no tiene permisos de WhatsApp sobre este número.',
    };
  }
  // 100/33 (and plain 100): the id does not exist or this token cannot see it.
  if (error?.code === 100) {
    return {
      path: 'whatsapp.externalAccountId',
      message:
        'Meta no encuentra ese Phone Number ID o el token no tiene acceso a él.',
    };
  }
  return {
    path: 'whatsapp.accessToken',
    message: `Meta rechazó las credenciales${message ? `: ${message}` : '.'}`,
  };
}
