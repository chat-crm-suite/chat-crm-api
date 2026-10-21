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
  const uploads = { stageFor: jest.fn() };
  const staged = { find: jest.fn() };
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
      uploads as never,
      staged as never,
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
      snapshot: {
        name: 'welcome',
        language: 'es',
        header: null,
        body: 'Hola Lucía',
        footer: null,
        buttons: [],
      },
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

  describe('header media and unsendable templates', () => {
    const UPLOAD_ID = '0b9f6a3e-5c1d-4f7e-9a2b-3c4d5e6f7a8b';
    const imageCta = remote({
      name: 'image_cta',
      externalId: 'ext-img',
      components: [
        { type: 'header', format: 'image', text: null },
        { type: 'body', text: 'Hola {{1}}' },
        { type: 'footer', text: 'Gracias' },
        {
          type: 'buttons',
          buttons: [{ type: 'url', text: 'Ver', url: 'https://x.test/{{1}}', phoneNumber: null }],
        },
      ],
      variables: [
        { key: '1', component: 'body', example: 'Ana' },
        { key: '0', component: 'buttons', example: null },
      ],
    });
    const carousel = remote({
      name: 'carousel',
      externalId: 'ext-car',
      components: [{ type: 'body', text: 'Recetas' }, { type: 'carousel' }],
      variables: [],
    });

    async function setup() {
      const company = await seed.company();
      const channel = await seed.channel(company);
      remotes = [imageCta, carousel];
      await service.sync(company.id, channel.id);
      const repo = dataSource.getRepository(MessageTemplate);
      return {
        company,
        admin: { companyId: company.id, role: 'admin' as const },
        conversation: { channelId: channel.id, channelType: 'whatsapp' as const },
        image: await repo.findOneByOrFail({ name: 'image_cta' }),
        slides: await repo.findOneByOrFail({ name: 'carousel' }),
      };
    }

    it('lists the header file kind and whether the template can be sent', async () => {
      const { admin } = await setup();

      const listed = await service.list(admin);
      expect(listed.map((t) => [t.name, t.headerMedia, t.sendSupport])).toEqual([
        ['carousel', null, { ok: false, reason: 'carousel' }],
        ['image_cta', 'image', { ok: true, reason: null }],
      ]);
    });

    it('refuses a carousel with 409 template_unsendable', async () => {
      const { admin, conversation, slides } = await setup();

      await expect(
        service.prepareSend(admin, conversation, { templateId: slides.id, params: {} }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'template_unsendable', reason: 'carousel' } });
    });

    it('requires a staged header file of the right kind', async () => {
      const { admin, conversation, image } = await setup();
      const params = { 'body:1': 'Ana', 'buttons:0': 'pedido-9' };

      await expect(
        service.prepareSend(admin, conversation, { templateId: image.id, params }),
      ).rejects.toMatchObject({ status: 400, response: { code: 'template_header_media_missing' } });

      staged.find.mockResolvedValueOnce(null);
      await expect(
        service.prepareSend(admin, conversation, {
          templateId: image.id,
          params,
          headerMedia: { uploadId: UPLOAD_ID },
        }),
      ).rejects.toMatchObject({ status: 400, response: { code: 'template_header_media_mismatch' } });
      expect(staged.find).toHaveBeenCalledWith(UPLOAD_ID, {
        companyId: admin.companyId,
        scope: `template:${image.id}`,
        kind: 'image',
      });
    });

    it('prepares the send with the file reference and a filled snapshot', async () => {
      const { admin, conversation, image } = await setup();
      staged.find.mockResolvedValueOnce({ uploadId: UPLOAD_ID, filename: 'promo.jpg' });

      const prepared = await service.prepareSend(admin, conversation, {
        templateId: image.id,
        params: { 'body:1': 'Ana', 'buttons:0': 'pedido-9' },
        headerMedia: { uploadId: UPLOAD_ID },
      });

      expect(prepared.headerMedia).toEqual({ uploadId: UPLOAD_ID, kind: 'image' });
      expect(prepared.snapshot).toEqual({
        name: 'image_cta',
        language: 'es',
        header: { kind: 'media', mediaType: 'image', filename: 'promo.jpg' },
        body: 'Hola Ana',
        footer: 'Gracias',
        buttons: [{ type: 'url', text: 'Ver', url: 'https://x.test/pedido-9', phoneNumber: null }],
      });
    });

    it('refuses a header file on a template whose header takes none', async () => {
      const company = await seed.company();
      const channel = await seed.channel(company);
      remotes = [remote()];
      await service.sync(company.id, channel.id);
      const welcome = await dataSource.getRepository(MessageTemplate).findOneByOrFail({ name: 'welcome' });
      const admin = { companyId: company.id, role: 'admin' as const };

      await expect(
        service.prepareSend(admin, { channelId: channel.id, channelType: 'whatsapp' }, {
          templateId: welcome.id,
          params: { 'body:1': 'x' },
          headerMedia: { uploadId: UPLOAD_ID },
        }),
      ).rejects.toMatchObject({ status: 400, response: { code: 'template_header_media_mismatch' } });
      await expect(
        service.stageHeaderMedia(admin, welcome.id, {} as never),
      ).rejects.toMatchObject({ status: 409, response: { code: 'template_header_media_not_needed' } });
    });

    it('stages the header file scoped to the template with its channel rules', async () => {
      const { admin, image, slides } = await setup();
      const file = { path: '/tmp/x', size: 1, mimetype: 'image/png', originalname: 'x.png' };
      uploads.stageFor.mockResolvedValueOnce({ uploadId: UPLOAD_ID });

      await expect(service.stageHeaderMedia(admin, image.id, file)).resolves.toEqual({
        uploadId: UPLOAD_ID,
      });
      expect(uploads.stageFor).toHaveBeenCalledWith(
        { companyId: admin.companyId, scope: `template:${image.id}`, channelType: 'whatsapp' },
        file,
        { kind: 'image' },
      );
      await expect(service.stageHeaderMedia(admin, slides.id, file)).rejects.toMatchObject({
        response: { code: 'template_unsendable' },
      });
    });
  });
});
