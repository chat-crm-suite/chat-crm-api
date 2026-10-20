// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { DataSource, DataSourceOptions } from 'typeorm';

import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from '@helpers/test-database.helper';
import { CHANNEL_STATUS, CHANNEL_TYPE } from '@contracts';
import { Channel } from '@modules/channels/entities/channel.entity';
import { Company } from '@modules/company/entities/company.entity';
// Lives outside src/migrations: the DataSources load every *.ts there as a migration.
import { DefaultWhatsAppChannel1791700000000 } from '@src/migrations/1791700000000-DefaultWhatsAppChannel';

/**
 * The backfill runs against companies created before every company was born
 * with a `pending` WhatsApp channel. It broke once in MySQL: a name-addressed
 * insert dropped `company_id` (the table resolved to the Channel entity).
 */
describe('DefaultWhatsAppChannel1791700000000 (migration)', () => {
  const migration = new DefaultWhatsAppChannel1791700000000();
  let dataSource: DataSource;

  const run = async (step: 'up' | 'down') => {
    const queryRunner = dataSource.createQueryRunner();
    try {
      await migration[step](queryRunner);
    } finally {
      await queryRunner.release();
    }
  };
  // Entity instances (`create`): plain objects skip `UuidV7Entity`'s id listener.
  const company = (name: string) => {
    const companies = dataSource.getRepository(Company);
    return companies.save(companies.create({ name }));
  };
  const activeChannel = (companyId: string) => {
    const channels = dataSource.getRepository(Channel);
    return channels.save(
      channels.create({
        companyId,
        type: CHANNEL_TYPE.whatsapp,
        name: 'Main',
        externalAccountId: 'phone-1',
        credentials: '{}',
        status: CHANNEL_STATUS.active,
      }),
    );
  };
  const whatsappOf = (companyId: string) =>
    dataSource
      .getRepository(Channel)
      .find({ where: { companyId, type: CHANNEL_TYPE.whatsapp }, withDeleted: true });

  beforeAll(async () => {
    dataSource = new DataSource(
      getTestSQLiteConfig(getSQLiteEntities()) as DataSourceOptions,
    );
    await dataSource.initialize();
  });
  afterAll(() => dataSource.destroy());
  beforeEach(() => clearSQLiteTables(dataSource));

  it('gives every live company without WhatsApp a pending channel with its own token', async () => {
    const legacy = await company('Legacy');
    const other = await company('Other');

    await run('up');

    const [channel] = await whatsappOf(legacy.id);
    expect(channel).toMatchObject({
      companyId: legacy.id,
      type: CHANNEL_TYPE.whatsapp,
      status: CHANNEL_STATUS.pending,
      externalAccountId: null,
      credentials: null,
      settings: { apiVersion: 'v22.0', apiBaseUrl: 'https://graph.facebook.com' },
    });
    expect(channel.webhookVerifyToken).toMatch(/^[a-f0-9]{64}$/);

    const [second] = await whatsappOf(other.id);
    expect(second.webhookVerifyToken).not.toBe(channel.webhookVerifyToken);
  });

  it('leaves a company that already has its WhatsApp channel alone', async () => {
    const configured = await company('Configured');
    await activeChannel(configured.id);

    await run('up');

    const channels = await whatsappOf(configured.id);
    expect(channels).toHaveLength(1);
    expect(channels[0].status).toBe(CHANNEL_STATUS.active);
  });

  it('skips soft-deleted companies', async () => {
    const gone = await company('Gone');
    await dataSource.getRepository(Company).softDelete(gone.id);

    await run('up');

    expect(await whatsappOf(gone.id)).toHaveLength(0);
  });

  it('can run again without duplicating channels', async () => {
    const legacy = await company('Legacy');

    await run('up');
    await run('up');

    expect(await whatsappOf(legacy.id)).toHaveLength(1);
  });

  it('down removes the pending channels and keeps configured ones', async () => {
    const legacy = await company('Legacy');
    const configured = await company('Configured');
    await activeChannel(configured.id);
    await run('up');

    await run('down');

    expect(await whatsappOf(legacy.id)).toHaveLength(0);
    expect(await whatsappOf(configured.id)).toHaveLength(1);
  });
});
