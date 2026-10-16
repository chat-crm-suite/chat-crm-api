// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createHmac } from 'crypto';

import {
  verifyWhatsAppSignature,
  verifyWhatsAppSignatureForChannels,
  webhookPhoneNumberIds,
} from './whatsapp-signature';

/**
 * T1 intake: the webhook trusts the body only when the Meta signature
 * (`X-Hub-Signature-256`) matches the HMAC of the raw bytes with the app
 * secret. Vectors below are independent literals (generated with openssl,
 * not with the implementation).
 */
describe('verifyWhatsAppSignature', () => {
  const secret = 'test-app-secret';

  it('accepts the exact Meta header for the raw body', () => {
    const rawBody = Buffer.from('hello-meta', 'utf8');

    expect(
      verifyWhatsAppSignature(
        rawBody,
        'sha256=8ffe19330dbd5f4f71c52285a4dc5858f6d33db395678f16bad56b84a9d07503',
        secret,
      ),
    ).toBe(true);
  });

  it('accepts a JSON webhook body signed by Meta', () => {
    const rawBody = Buffer.from(
      '{"object":"whatsapp_business_account"}',
      'utf8',
    );

    expect(
      verifyWhatsAppSignature(
        rawBody,
        'sha256=b6978b21c4467654c466607663db9b43fae44b71083568df403e0a077089208e',
        secret,
      ),
    ).toBe(true);
  });

  it('rejects a body signed with another secret', () => {
    expect(
      verifyWhatsAppSignature(
        Buffer.from('hello-meta', 'utf8'),
        'sha256=8ffe19330dbd5f4f71c52285a4dc5858f6d33db395678f16bad56b84a9d07503',
        'wrong-secret',
      ),
    ).toBe(false);
  });

  it('rejects a tampered body', () => {
    expect(
      verifyWhatsAppSignature(
        Buffer.from('hello-meta-tampered', 'utf8'),
        'sha256=8ffe19330dbd5f4f71c52285a4dc5858f6d33db395678f16bad56b84a9d07503',
        secret,
      ),
    ).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(
      verifyWhatsAppSignature(Buffer.from('hello-meta', 'utf8'), undefined, secret),
    ).toBe(false);
  });

  it('rejects a malformed header', () => {
    for (const header of [
      '8ffe19330dbd5f4f71c52285a4dc5858f6d33db395678f16bad56b84a9d07503',
      'sha1=8ffe19330dbd5f4f71c52285a4dc5858f6d33db395678f16bad56b84a9d07503',
      'sha256=zzzz',
      '',
    ]) {
      expect(
        verifyWhatsAppSignature(
          Buffer.from('hello-meta', 'utf8'),
          header,
          secret,
        ),
      ).toBe(false);
    }
  });

  it('rejects when no app secret is configured', () => {
    expect(
      verifyWhatsAppSignature(
        Buffer.from('hello-meta', 'utf8'),
        'sha256=8ffe19330dbd5f4f71c52285a4dc5858f6d33db395678f16bad56b84a9d07503',
        '',
      ),
    ).toBe(false);
  });
});

describe('per-channel webhook signatures', () => {
  const SECRET_A = 'a'.repeat(32);
  const SECRET_B = 'b'.repeat(32);
  const ATTACKER = 'f'.repeat(32);
  const body = (ids: string[]) =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: ids.map((id) => ({
        id: 'waba',
        changes: [{ field: 'messages', value: { metadata: { phone_number_id: id } } }],
      })),
    });
  const sign = (raw: string, secret: string) =>
    `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  describe('webhookPhoneNumberIds', () => {
    it('collects distinct ids across entries and changes', () => {
      expect(webhookPhoneNumberIds(JSON.parse(body(['111', '222', '111'])))).toEqual([
        '111',
        '222',
      ]);
    });

    it('returns nothing for malformed payloads', () => {
      expect(webhookPhoneNumberIds(undefined)).toEqual([]);
      expect(webhookPhoneNumberIds({ entry: 'x' })).toEqual([]);
      expect(webhookPhoneNumberIds({ entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
    });
  });

  describe('verifyWhatsAppSignatureForChannels', () => {
    it('accepts a post signed with the channel own secret', () => {
      const raw = body(['111']);
      expect(
        verifyWhatsAppSignatureForChannels(Buffer.from(raw), sign(raw, SECRET_A), [[SECRET_A]]),
      ).toBe(true);
    });

    it('accepts each company with its own Meta app secret', () => {
      const rawB = body(['222']);
      expect(
        verifyWhatsAppSignatureForChannels(Buffer.from(rawB), sign(rawB, SECRET_B), [[SECRET_B]]),
      ).toBe(true);
    });

    it('rejects a post mixing an attacker channel with another company channel', () => {
      const raw = body(['999', '222']);
      expect(
        verifyWhatsAppSignatureForChannels(Buffer.from(raw), sign(raw, ATTACKER), [
          [ATTACKER],
          [SECRET_B],
        ]),
      ).toBe(false);
    });

    it('accepts any of the candidates of one channel', () => {
      const raw = body(['111']);
      expect(
        verifyWhatsAppSignatureForChannels(Buffer.from(raw), sign(raw, SECRET_A), [
          [SECRET_B, SECRET_A],
        ]),
      ).toBe(true);
    });

    it('fails closed with no channels or no candidates', () => {
      const raw = body(['111']);
      expect(verifyWhatsAppSignatureForChannels(Buffer.from(raw), sign(raw, SECRET_A), [])).toBe(
        false,
      );
      expect(verifyWhatsAppSignatureForChannels(Buffer.from(raw), sign(raw, SECRET_A), [[]])).toBe(
        false,
      );
    });
  });
});
