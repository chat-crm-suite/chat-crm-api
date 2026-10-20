// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DataSource, DataSourceOptions } from 'typeorm';

import { inboxSeed } from '@helpers/inbox-seed';
import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from '@helpers/test-database.helper';
import { buildWhatsAppTemplateSend } from '../../integrations/whatsapp/templates/whatsapp-template.mapper';
import { Channel } from '../channels/entities/channel.entity';
import { MessageTemplate } from '../channels/entities/message-template.entity';
import type { RemoteTemplate } from '../channels/ports/channel-template.port';
import { ChannelTemplateRegistry } from '../channels/ports/channel-template.registry';
import { TemplatesService } from './templates.service';

jest.setTimeout(60_000);

const logger = { setContext: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() };

const remote = (overrides: Partial<RemoteTemplate> = {}): RemoteTemplate => ({
  externalId: 'ext-1',
  name: 'welcome',
  language: 'es',
  category: 'utility',
  status: 'approved',
  statusReason: null,
  components: [{ type: 'body', text: 'Hola {{1}}' }],
  variables: [{ key: '1', component: 'body', example: 'Ana' }],
  ...overrides,
});

/** Sync upsert/disable, visibility and send validation on SQLite. */
describe('TemplatesService', () => {
  let dataSource: DataSource;
  let seed: ReturnType<typeof inboxSeed>;
  let service: TemplatesService;
  let remotes: RemoteTemplate[] = [];
  const provider = {
    type: 'whatsapp' as const,
    listRemote: jest.fn(() => Promise.resolve({ ok: true as const, templates: remotes })),
    buildSend: buildWhatsAppTemplateSend,
  };

  beforeAll(async () => {
    dataSource = new DataSource(getTestSQLiteConfig(getSQLiteEntities()) as DataSourceOptions);
    await dataSource.initialize();
    seed = inboxSeed(dataSource);

    const registry = new ChannelTemplateRegistry();
    registry.register(provider);
    service = new TemplatesService(
      dataSource.getRepository(MessageTemplate),
      dataSource.getRepository(Channel),
      registry,
      dataSource,
      logger as never,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    remotes = [];
    jest.clearAllMocks();
  });

  it('upserts by name + language, reports status changes and disables vanished templates', async () => {
    const company = await seed.company();
    const channel = await seed.channel(company);

    remotes = [remote(), remote({ name: 'promo', status: 'pending', externalId: 'ext-2' })];
    const first = await service.sync(company.id, channel.id);
    expect(first).toMatchObject({ total: 2, created: 2, updated: 0, disabled: 0 });
    expect(first.statusChanges.every((change) => change.templateId)).toBe(true);

    remotes = [remote({ status: 'paused', statusReason: 'LOW_QUALITY' })];
    const second = await service.sync(company.id, channel.id);
    expect(second).toMatchObject({ total: 1, created: 0, updated: 1, disabled: 1 });
    expect(second.statusChanges.map((change) => [change.name, change.from, change.to])).toEqual([
      ['welcome', 'approved', 'paused'],
      ['promo', 'pending', 'disabled'],
    ]);

    const rows = await dataSource.getRepository(MessageTemplate).find({ order: { name: 'ASC' } });
    expect(rows.map((row) => [row.name, row.status, row.statusReason])).toEqual([
      ['promo', 'disabled', null],
      ['welcome', 'paused', 'LOW_QUALITY'],
    ]);
    expect(rows.every((row) => row.syncedAt)).toBe(true);
  });

  it('answers 409 templates_unsupported and 502 on provider faults', async () => {
    const company = await seed.company();
    const telegram = await seed.channel(company, 'telegram');
    const whatsapp = await seed.channel(company);

    await expect(service.sync(company.id, telegram.id)).rejects.toMatchObject({
      response: { code: 'templates_unsupported' },
    });

    provider.listRemote.mockResolvedValueOnce({
      ok: false,
      error: { authFault: true, retryable: false, message: 'bad token' },
    } as never);
    await expect(service.sync(company.id, whatsapp.id)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('shows agents only approved templates flagged for them', async () => {
    const company = await seed.company();
    const channel = await seed.channel(company);
    remotes = [remote(), remote({ name: 'draft', status: 'pending', externalId: 'ext-3' })];
    await service.sync(company.id, channel.id);
    const welcome = await dataSource.getRepository(MessageTemplate).findOneByOrFail({ name: 'welcome' });

    expect((await service.list({ companyId: company.id, role: 'admin' })).map((t) => t.name)).toEqual([
      'draft',
      'welcome',
    ]);
    expect(
      (await service.list({ companyId: company.id, role: 'agent' }, { status: 'pending' })).map(
        (t) => t.name,
      ),
    ).toEqual(['welcome']);

    await service.updateSettings(company.id, welcome.id, { visibleToAgents: false });
    expect(await service.list({ companyId: company.id, role: 'agent' })).toEqual([]);
  });

  it('validates a send: same channel, approved, visible, every variable filled', async () => {
    const company = await seed.company();
    const channel = await seed.channel(company);
    const other = await seed.channel(company);
    remotes = [remote()];
    await service.sync(company.id, channel.id);
    const welcome = await dataSource.getRepository(MessageTemplate).findOneByOrFail({ name: 'welcome' });
    const agent = { companyId: company.id, role: 'agent' as const };
    const conversation = { channelId: channel.id, channelType: 'whatsapp' as const };

    await expect(
      service.prepareSend(agent, { ...conversation, channelId: other.id }, {
        templateId: welcome.id,
        params: { 'body:1': 'x' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.prepareSend(agent, conversation, { templateId: welcome.id, params: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const prepared = await service.prepareSend(agent, conversation, {
      templateId: welcome.id,
      params: { 'body:1': 'Lucía' },
    });
    expect(prepared).toEqual({
      templateId: welcome.id,
      body: 'Hola Lucía',
      template: {
        name: 'welcome',
        language: 'es',
        header: [],
        body: [{ key: '1', value: 'Lucía' }],
        buttons: [],
      },
    });

    await service.updateSettings(company.id, welcome.id, { visibleToAgents: false });
    await expect(
      service.prepareSend(agent, conversation, { templateId: welcome.id, params: { 'body:1': 'x' } }),
    ).rejects.toMatchObject({ response: { code: 'template_unavailable' } });
    // Admins and supervisors still send hidden templates.
    await expect(
      service.prepareSend({ companyId: company.id, role: 'supervisor' }, conversation, {
        templateId: welcome.id,
        params: { 'body:1': 'x' },
      }),
    ).resolves.toMatchObject({ templateId: welcome.id });
  });
});
