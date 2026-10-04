import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * App-level encryption for channel credentials (`channels.credentials`).
 *
 * AES-256-GCM with a single key from `CREDENTIALS_ENCRYPTION_KEY`
 * (64 hex chars or base64 of 32 bytes). Stored format is a JSON envelope so
 * the algorithm can be rotated later without a schema change.
 */
const ALGORITHM = 'aes-256-gcm';
const KEY_ENV = 'CREDENTIALS_ENCRYPTION_KEY';

export interface CredentialsEnvelope {
  v: 1;
  /** base64, 12 bytes */
  iv: string;
  /** base64 GCM auth tag */
  authTag: string;
  /** base64 ciphertext */
  ciphertext: string;
}

function loadKey(): Buffer {
  const raw = process.env[KEY_ENV]?.trim();
  if (!raw) {
    throw new Error(
      `${KEY_ENV} is not set: cannot encrypt/decrypt channel credentials`,
    );
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (key.length !== 32) {
    throw new Error(
      `${KEY_ENV} must decode to 32 bytes (64 hex chars or base64)`,
    );
  }

  return key;
}

export function encryptCredentials(payload: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, loadKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);

  const envelope: CredentialsEnvelope = {
    v: 1,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };

  return JSON.stringify(envelope);
}

export function decryptCredentials<T = Record<string, unknown>>(
  stored: string,
): T {
  const envelope = JSON.parse(stored) as CredentialsEnvelope;

  if (envelope.v !== 1) {
    throw new Error(`Unsupported credentials envelope version: ${envelope.v}`);
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    loadKey(),
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString('utf8')) as T;
}
