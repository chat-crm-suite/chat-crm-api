import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Meta webhook signature (`X-Hub-Signature-256: sha256=<hex>`), computed
 * over the raw request bytes with the single app secret.
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
