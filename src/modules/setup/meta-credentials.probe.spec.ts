// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createHmac } from 'crypto';

import { MetaCredentialsProbe, toFieldError } from './meta-credentials.probe';

/**
 * The probe makes one read-only Graph call, always to graph.facebook.com,
 * and maps Meta's error onto the wizard field to fix.
 */
describe('MetaCredentialsProbe', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  const input = {
    phoneNumberId: '123456789012345',
    accessToken: 'EAAB-token',
    apiVersion: 'v22.0',
  };
  const reply = (status: number, body: unknown) =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('calls Graph with the token and an appsecret_proof', async () => {
    fetchMock.mockReturnValue(
      reply(200, { display_phone_number: '+51 999', verified_name: 'J&P' }),
    );
    const secret = 'a'.repeat(32);

    const result = await new MetaCredentialsProbe().probe({
      ...input,
      appSecret: secret,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const proof = createHmac('sha256', secret)
      .update(input.accessToken)
      .digest('hex');
    expect(
      url.startsWith('https://graph.facebook.com/v22.0/123456789012345?'),
    ).toBe(true);
    expect(new URL(url).searchParams.get('appsecret_proof')).toBe(proof);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer EAAB-token',
    );
    expect(result).toEqual({
      kind: 'ok',
      displayPhoneNumber: '+51 999',
      verifiedName: 'J&P',
    });
  });

  it('reports a Graph 4xx as invalid credentials', async () => {
    fetchMock.mockReturnValue(
      reply(401, { error: { code: 190, message: 'expired' } }),
    );

    await expect(new MetaCredentialsProbe().probe(input)).resolves.toEqual({
      kind: 'invalid',
      errors: [expect.objectContaining({ path: 'whatsapp.accessToken' })],
    });
  });

  it('treats network failures and 5xx as unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      new MetaCredentialsProbe().probe(input),
    ).resolves.toMatchObject({ kind: 'unreachable' });

    fetchMock.mockReturnValueOnce(reply(503, {}));
    await expect(
      new MetaCredentialsProbe().probe(input),
    ).resolves.toMatchObject({ kind: 'unreachable' });
  });

  describe('toFieldError', () => {
    it('maps a bad appsecret_proof to the App Secret field', () => {
      const error = {
        code: 100,
        message: 'Invalid appsecret_proof provided in the API argument',
      };
      expect(toFieldError(error, true).path).toBe('whatsapp.appSecret');
    });

    it('maps 190 and permission errors to the access token', () => {
      expect(toFieldError({ code: 190 }, false).path).toBe(
        'whatsapp.accessToken',
      );
      expect(toFieldError({ code: 200 }, false).path).toBe(
        'whatsapp.accessToken',
      );
    });

    it('maps an unknown object (100) to the phone number id', () => {
      expect(toFieldError({ code: 100, error_subcode: 33 }, false).path).toBe(
        'whatsapp.externalAccountId',
      );
    });
  });
});
