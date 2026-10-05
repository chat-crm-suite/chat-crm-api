import { verifyWhatsAppSignature } from './whatsapp-signature';

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
