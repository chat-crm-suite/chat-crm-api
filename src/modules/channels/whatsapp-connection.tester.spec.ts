// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { WhatsAppCredentials } from '../../contracts/index';
import type { Channel } from './entities/channel.entity';
import { WhatsAppConnectionTester } from './whatsapp-connection.tester';

const WEBHOOK = 'https://abc.ngrok-free.app/integration/webhook/whatsapp';

const channel = (overrides: Partial<Channel> = {}): Channel =>
  ({
    id: 'ch-1',
    companyId: 'co-1',
    type: 'whatsapp',
    externalAccountId: 'phone-1',
    status: 'active',
    settings: { apiVersion: 'v22.0', webhookUrl: WEBHOOK },
    webhookVerifyToken: 'verify-token',
    ...overrides,
  }) as unknown as Channel;

const credentials: WhatsAppCredentials = {
  accessToken: 'token-123',
  businessId: 'waba-1',
};

/** Echoes `hub.challenge` like our webhook controller does. */
const echoChallenge = (url: URL) =>
  new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });

describe('WhatsAppConnectionTester', () => {
  let probe: { probe: jest.Mock };
  let fetchMock: jest.SpyInstance;
  let tester: WhatsAppConnectionTester;

  /** Routes the mocked fetch: Graph `subscribed_apps` vs the webhook URL. */
  const route = (
    webhook: (url: URL) => Response | Promise<Response>,
    subscribed: () => Response = () => Response.json({ data: [{ id: 'app' }] }),
  ) =>
    fetchMock.mockImplementation((input: string | URL) => {
      const url = new URL(String(input));
      return Promise.resolve(
        url.hostname === 'graph.facebook.com' ? subscribed() : webhook(url),
      );
    });

  beforeEach(() => {
    probe = {
      probe: jest.fn().mockResolvedValue({
        kind: 'ok',
        displayPhoneNumber: '+51 999',
        verifiedName: 'Acme',
      }),
    };
    fetchMock = jest.spyOn(globalThis, 'fetch');
    tester = new WhatsAppConnectionTester(probe);
  });

  afterEach(() => fetchMock.mockRestore());

  it('is ok when sending, webhook and subscription all pass', async () => {
    route(echoChallenge);

    const result = await tester.test(channel(), credentials);

    expect(result.ok).toBe(true);
    expect(result.sending).toMatchObject({
      status: 'ok',
      displayPhoneNumber: '+51 999',
    });
    expect(result.webhook).toMatchObject({ status: 'ok', url: WEBHOOK });
    expect(result.subscription.status).toBe('ok');
  });

  it('sends the stored verify token and a fresh challenge to the webhook', async () => {
    route(echoChallenge);

    await tester.test(channel(), credentials);

    const webhookCall = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((url) => url.hostname !== 'graph.facebook.com');
    expect(webhookCall?.searchParams.get('hub.mode')).toBe('subscribe');
    expect(webhookCall?.searchParams.get('hub.verify_token')).toBe(
      'verify-token',
    );
    expect(webhookCall?.searchParams.get('hub.challenge')).toMatch(
      /^[a-f0-9]{32}$/,
    );
  });

  it('fails the sending check with the Meta error message', async () => {
    route(echoChallenge);
    probe.probe.mockResolvedValue({
      kind: 'invalid',
      errors: [{ path: 'whatsapp.accessToken', message: 'Token caducado.' }],
    });

    const result = await tester.test(channel(), credentials);

    expect(result.ok).toBe(false);
    expect(result.sending).toMatchObject({
      status: 'failed',
      message: 'Token caducado.',
    });
  });

  it('skips sending while the channel is pending', async () => {
    route(echoChallenge);

    const result = await tester.test(
      channel({ externalAccountId: null, status: 'pending' }),
      { accessToken: '' },
    );

    expect(probe.probe).not.toHaveBeenCalled();
    expect(result.sending.status).toBe('skipped');
    expect(result.subscription.status).toBe('skipped');
    expect(result.webhook.status).toBe('ok');
    expect(result.ok).toBe(false);
  });

  it('fails the webhook when the tunnel is down', async () => {
    route(() => {
      throw new TypeError('fetch failed');
    });

    const result = await tester.test(channel(), credentials);

    expect(result.ok).toBe(false);
    expect(result.webhook.status).toBe('failed');
    expect(result.webhook.message).toContain('ngrok');
  });

  it('fails the webhook when it rejects the verify token', async () => {
    route(() => new Response('', { status: 403 }));

    const result = await tester.test(channel(), credentials);

    expect(result.webhook.status).toBe('failed');
    expect(result.webhook.message).toContain('verify token');
  });

  it('fails the webhook when it answers without the challenge', async () => {
    route(() => new Response('<html>ngrok</html>', { status: 200 }));

    const result = await tester.test(channel(), credentials);

    expect(result.webhook.status).toBe('failed');
  });

  it('skips the webhook when no URL is saved', async () => {
    route(echoChallenge);

    const result = await tester.test(
      channel({ settings: { apiVersion: 'v22.0' } }),
      credentials,
    );

    expect(result.webhook.status).toBe('skipped');
    expect(result.ok).toBe(false);
  });

  it('refuses webhook URLs that are not http(s)', async () => {
    route(echoChallenge);

    const result = await tester.test(
      channel({ settings: { webhookUrl: 'file:///etc/passwd' } }),
      credentials,
    );

    expect(result.webhook.status).toBe('failed');
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).startsWith('file:')),
    ).toBe(false);
  });

  it('fails the subscription when the Meta app is not subscribed', async () => {
    route(echoChallenge, () => Response.json({ data: [] }));

    const result = await tester.test(channel(), credentials);

    expect(result.subscription.status).toBe('failed');
    expect(result.ok).toBe(false);
  });

  it('stays ok when only the subscription is skipped (no Business ID)', async () => {
    route(echoChallenge);

    const result = await tester.test(channel(), { accessToken: 'token-123' });

    expect(result.subscription.status).toBe('skipped');
    expect(result.ok).toBe(true);
  });
});
