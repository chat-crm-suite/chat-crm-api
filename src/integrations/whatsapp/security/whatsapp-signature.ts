// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Meta webhook signature (`X-Hub-Signature-256: sha256=<hex>`), computed
 * over the raw request bytes with one Meta app's secret.
 */
export function verifyWhatsAppSignature(
  rawBody: Buffer,
  signature: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !signature || !appSecret) return false;
  if (!signature.startsWith('sha256=')) return false;

  const receivedHex = signature.slice('sha256='.length);
  if (!/^[0-9a-fA-F]+$/.test(receivedHex)) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(receivedHex, 'hex');
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;

  return timingSafeEqual(received, expected);
}

/**
 * Distinct `phone_number_id`s a webhook post talks about. The payload is not
 * trusted yet: these ids only pick which secrets the signature must match.
 */
export function webhookPhoneNumberIds(payload: unknown): string[] {
  const ids = new Set<string>();
  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return [];

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const id = (change as { value?: { metadata?: { phone_number_id?: unknown } } })
        ?.value?.metadata?.phone_number_id;
      if (typeof id === 'string' && id) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Multi-tenant check: every channel a post mentions must accept the signature
 * with one of ITS secrets. "Any channel" would let the owner of one Meta app
 * sign a post that also injects events into another company's channel.
 *
 * @param candidatesPerChannel one list of acceptable secrets per mentioned
 *   channel (its own App Secret, else the server-wide fallback)
 */
export function verifyWhatsAppSignatureForChannels(
  rawBody: Buffer,
  signature: string | undefined,
  candidatesPerChannel: string[][],
): boolean {
  if (candidatesPerChannel.length === 0) return false;
  return candidatesPerChannel.every((candidates) =>
    candidates.some((secret) =>
      verifyWhatsAppSignature(rawBody, signature, secret),
    ),
  );
}
