// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { DataSource, DataSourceOptions } from 'typeorm';

import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from '@helpers/test-database.helper';
import { NOTIFICATION_TYPES } from '../../contracts/index';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { Company } from '../company/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { Notification } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';

jest.setTimeout(60_000);

/** Per-member muting of notification types, on in-memory SQLite. */
describe('NotificationsService (integration)', () => {
  let dataSource: DataSource;
  let service: NotificationsService;
  let company: Company;
  let member: CompanyMember;
  let other: CompanyMember;
  let seq = 0;

  const newMember = async () => {
    const users = dataSource.getRepository(User);
    const user = await users.save(users.create({ username: `u-${++seq}`, passwordHash: 'x' }));
    const members = dataSource.getRepository(CompanyMember);
    return members.save(members.create({ companyId: company.id, userId: user.id, role: 'agent' }));
  };

  const notify = (recipient: CompanyMember, type: (typeof NOTIFICATION_TYPES)[number]) =>
    service.create({
      companyId: company.id,
      recipientMemberId: recipient.id,
      type,
      title: `title ${type}`,
    });

  beforeAll(async () => {
    dataSource = new DataSource(
      getTestSQLiteConfig(getSQLiteEntities()) as DataSourceOptions,
    );
    await dataSource.initialize();
    service = new NotificationsService(
      dataSource.getRepository(Notification),
      dataSource.getRepository(CompanyMember),
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    const companies = dataSource.getRepository(Company);
    company = await companies.save(companies.create({ name: 'Acme' }));
    member = await newMember();
    other = await newMember();
  });

  it('stores every type until the member mutes one', async () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(await notify(member, type)).toMatchObject({ type, recipientMemberId: member.id });
    }

    expect(await dataSource.getRepository(Notification).count()).toBe(NOTIFICATION_TYPES.length);
  });

  it('reads an empty preference set for a member who never chose', async () => {
    await expect(service.getPreferences(member.id)).resolves.toEqual({ muted: [] });
    await expect(service.getPreferences('unknown-member')).resolves.toEqual({ muted: [] });
  });

  it('skips a muted type for that member: nothing stored, null returned', async () => {
    await service.setPreferences(member.id, { muted: ['queue_unassigned'] });

    expect(await notify(member, 'queue_unassigned')).toBeNull();
    expect(await dataSource.getRepository(Notification).count()).toBe(0);
  });

  it('keeps delivering the types that are not muted, and the muted type to others', async () => {
    await service.setPreferences(member.id, { muted: ['queue_unassigned'] });

    expect(await notify(member, 'conversation_assigned')).not.toBeNull();
    expect(await notify(member, 'spend_budget')).not.toBeNull();
    expect(await notify(other, 'queue_unassigned')).not.toBeNull();
    expect(await dataSource.getRepository(Notification).count()).toBe(3);
  });

  it('applies a new preference right away and lets the member unmute', async () => {
    await service.setPreferences(member.id, { muted: [...NOTIFICATION_TYPES] });
    for (const type of NOTIFICATION_TYPES) expect(await notify(member, type)).toBeNull();

    await service.setPreferences(member.id, { muted: [] });
    expect(await notify(member, 'spend_budget')).not.toBeNull();
  });

  it('round-trips the preferences through the json column, deduplicated', async () => {
    const saved = await service.setPreferences(member.id, {
      muted: ['spend_budget', 'spend_budget', 'queue_unassigned'],
    });

    expect(saved).toEqual({ muted: ['spend_budget', 'queue_unassigned'] });
    await expect(service.getPreferences(member.id)).resolves.toEqual(saved);
    await expect(service.getPreferences(other.id)).resolves.toEqual({ muted: [] });
  });

  it('counts only unread notifications of a type for the queue dedupe', async () => {
    await notify(member, 'queue_unassigned');

    await expect(service.hasUnread(member.id, 'queue_unassigned')).resolves.toBe(true);
    await expect(service.hasUnread(member.id, 'spend_budget')).resolves.toBe(false);
  });
});
