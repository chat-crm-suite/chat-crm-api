// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { WhatsAppCredentials } from '../../contracts/index';
import {
  decryptCredentials,
  encryptCredentials,
} from '../../lib/helpers/credentials.helper';
import { ChannelsService } from './channels.service';
import type { Channel } from './entities/channel.entity';

/**
 * Per-channel Meta App Secret: stored inside the encrypted credentials,
 * write-only (responses only say `hasAppSecret`), and served to the webhook
 * through a short cache that every channel write clears.
 */
describe('ChannelsService (App Secret)', () => {
  const APP_SECRET = 'a'.repeat(32);
  const originalKey = process.env.CREDENTIALS_ENCRYPTION_KEY;

  let rows: Channel[];
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    merge: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let service: ChannelsService;

  const channelRow = (credentials: WhatsAppCredentials): Channel =>
    ({
      id: 'ch-1',
      companyId: 'co-1',
      type: 'whatsapp',
      name: 'WhatsApp',
      externalAccountId: 'phone-1',
      status: 'active',
      credentials: encryptCredentials(credentials),
      settings: {},
      webhookVerifyToken: 'verify',
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as unknown as Channel;

  beforeAll(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = '0'.repeat(64);
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = originalKey;
  });

  beforeEach(() => {
    rows = [];
    repo = {
      create: jest.fn((data: Partial<Channel>) => ({ ...data }) as Channel),
      save: jest.fn((row: Channel) => {
        const saved = {
          id: 'ch-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...row,
        } as Channel;
        rows = [saved];
        return Promise.resolve(saved);
      }),
      merge: jest.fn((row: Channel, patch: Partial<Channel>) =>
        Object.assign(row, patch),
      ),
      find: jest.fn(() => Promise.resolve(rows)),
      findOne: jest.fn(() => Promise.resolve(rows[0] ?? null)),
    };
    service = new ChannelsService(
      repo as never,
      { get: jest.fn().mockReturnValue('co-1') } as never,
    );
  });

  it('stores the App Secret encrypted and only reports hasAppSecret', async () => {
    const response = await service.create({
      type: 'whatsapp',
      externalAccountId: 'phone-1',
      accessToken: 'token-123',
      appSecret: APP_SECRET,
    });

    expect(response.hasAppSecret).toBe(true);
    expect(JSON.stringify(response)).not.toContain(APP_SECRET);
    expect(rows[0].credentials).not.toContain(APP_SECRET);
    expect(
      decryptCredentials<WhatsAppCredentials>(rows[0].credentials).appSecret,
    ).toBe(APP_SECRET);
  });

  it('reports hasAppSecret false for a channel without one', async () => {
    const response = await service.create({
      type: 'whatsapp',
      externalAccountId: 'phone-1',
      accessToken: 'token-123',
    });

    expect(response.hasAppSecret).toBe(false);
  });

  it('keeps the App Secret when only the access token changes', async () => {
    rows = [channelRow({ accessToken: 'old', appSecret: APP_SECRET })];

    const response = await service.updateWhatsAppConfig({ accessToken: 'new' });

    const stored = decryptCredentials<WhatsAppCredentials>(rows[0].credentials);
    expect(stored).toMatchObject({ accessToken: 'new', appSecret: APP_SECRET });
    expect(response?.hasAppSecret).toBe(true);
  });

  it('never returns the App Secret from the settings endpoint', async () => {
    rows = [channelRow({ accessToken: 'tok', appSecret: APP_SECRET })];

    const config = await service.getWhatsAppConfigWithToken();

    expect(JSON.stringify(config)).not.toContain(APP_SECRET);
    expect(config?.hasAppSecret).toBe(true);
  });

  it('serves webhook secrets from cache and refreshes after a write', async () => {
    rows = [channelRow({ accessToken: 'tok', appSecret: APP_SECRET })];

    await expect(service.getWebhookAppSecrets('phone-1')).resolves.toEqual([
      APP_SECRET,
    ]);
    await service.getWebhookAppSecrets('phone-1');
    expect(repo.find).toHaveBeenCalledTimes(1);

    const replaced = 'b'.repeat(32);
    await service.updateWhatsAppConfig({ appSecret: replaced });

    await expect(service.getWebhookAppSecrets('phone-1')).resolves.toEqual([
      replaced,
    ]);
    expect(repo.find).toHaveBeenCalledTimes(2);
  });

  it('returns no webhook secrets when the channel has none', async () => {
    rows = [channelRow({ accessToken: 'tok' })];

    await expect(service.getWebhookAppSecrets('phone-1')).resolves.toEqual([]);
  });
});
