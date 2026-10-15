// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import * as bcrypt from 'bcrypt';
import type { PinoLogger } from 'nestjs-pino';
import { DataSource, DataSourceOptions } from 'typeorm';

import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from '@helpers/test-database.helper';
import type { SessionRevocationService } from '../../auth/session/session-revocation.service';
import type { PlatformCompanyQuery } from '../../contracts/index';
import { Channel } from '../channels/entities/channel.entity';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { MemberProvisioningService } from '../company-members/member-provisioning.service';
import { CompanySettings } from '../company/entities/company-settings.entity';
import { Company } from '../company/entities/company.entity';
import { Customer } from '../customers/entities/customer.entity';
import { PipelineStage } from '../customers/entities/pipeline-stage.entity';
import { User } from '../users/entities/user.entity';
import { PlatformCompaniesService } from './platform-companies.service';

jest.setTimeout(60_000);

const ACTOR = 'platform-admin-1';

/** Companies management of the console on in-memory SQLite. */
describe('PlatformCompaniesService (integration)', () => {
  let dataSource: DataSource;
  let service: PlatformCompaniesService;
  let sessions: { revoke: jest.Mock };
  let logger: { setContext: jest.Mock; info: jest.Mock };

  const query = (overrides: Partial<PlatformCompanyQuery> = {}): PlatformCompanyQuery => ({
    page: 1,
    perPage: 10,
    sort: [],
    includeDeleted: false,
    ...overrides,
  });

  const save = <T extends object>(entity: new () => T, data: Partial<T>) => {
    const repo = dataSource.getRepository(entity);
    return repo.save(repo.create(data as T));
  };

  let seq = 0;
  const addMember = async (company: Company, role: 'admin' | 'agent' = 'agent') => {
    const user = await save(User, { username: `user-${++seq}`, passwordHash: 'x' });
    const member = await save(CompanyMember, { companyId: company.id, userId: user.id, role });
    return { user, member };
  };

  const revokedUsers = () =>
    sessions.revoke.mock.calls.map(([userId]) => userId as string).sort();

  beforeAll(async () => {
    dataSource = new DataSource(
      getTestSQLiteConfig(getSQLiteEntities()) as DataSourceOptions,
    );
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    sessions = { revoke: jest.fn().mockResolvedValue(undefined) };
    logger = { setContext: jest.fn(), info: jest.fn() };
    service = new PlatformCompaniesService(
      dataSource.getRepository(Company),
      dataSource.getRepository(CompanyMember),
      dataSource,
      new MemberProvisioningService(),
      sessions as unknown as SessionRevocationService,
      logger as unknown as PinoLogger,
    );
  });

  describe('create()', () => {
    it('creates the company with its settings row and default pipeline, and no admin', async () => {
      const result = await service.create(
        { name: 'Acme', email: 'hello@acme.test', timezone: 'America/Bogota' },
        ACTOR,
      );

      expect(result.company).toMatchObject({
        name: 'Acme',
        email: 'hello@acme.test',
        timezone: 'America/Bogota',
        status: 'active',
        membersCount: 0,
        customersCount: 0,
        channelsCount: 0,
        deletedAt: null,
      });
      expect(result.adminOutcome).toBeNull();
      expect(result.initialPassword).toBeUndefined();

      const id = result.company.id;
      expect(
        await dataSource.getRepository(CompanySettings).countBy({ companyId: id }),
      ).toBe(1);
      expect(
        await dataSource.getRepository(PipelineStage).countBy({ companyId: id }),
      ).toBeGreaterThan(0);
      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('creates the first admin account with a one-time password (outcome created)', async () => {
      const result = await service.create(
        {
          name: 'Acme',
          admin: { email: 'Boss@Acme.test', firstName: 'Bea', lastName: 'Boss' },
        },
        ACTOR,
      );

      expect(result.adminOutcome).toBe('created');
      expect(result.initialPassword).toEqual(expect.any(String));
      expect(result.company.membersCount).toBe(1);

      const user = await dataSource
        .getRepository(User)
        .findOneByOrFail({ email: 'boss@acme.test' });
      expect(await bcrypt.compare(result.initialPassword!, user.passwordHash)).toBe(true);

      const member = await dataSource
        .getRepository(CompanyMember)
        .findOneByOrFail({ userId: user.id });
      expect(member).toMatchObject({
        companyId: result.company.id,
        role: 'admin',
        status: 'active',
        createdByMemberId: null,
      });
      // The new account has no live session; nothing to refresh.
      expect(revokedUsers()).toEqual([user.id]);
    });

    it('links an existing account by email without a password (outcome linked)', async () => {
      const existing = await save(User, {
        username: 'ana',
        email: 'ana@acme.test',
        passwordHash: 'keep-me',
      });

      const result = await service.create(
        { name: 'Acme Two', admin: { email: 'ana@acme.test' } },
        ACTOR,
      );

      expect(result.adminOutcome).toBe('linked');
      expect(result.initialPassword).toBeUndefined();
      expect(
        (await dataSource.getRepository(User).findOneByOrFail({ id: existing.id }))
          .passwordHash,
      ).toBe('keep-me');
      // Her token does not list the new company yet: sessions are revoked.
      expect(revokedUsers()).toEqual([existing.id]);
    });

    it('answers 409 for a company email already used, even by a deleted company', async () => {
      const first = await service.create({ name: 'Acme', email: 'hello@acme.test' }, ACTOR);

      await expect(
        service.create({ name: 'Other', email: 'hello@acme.test' }, ACTOR),
      ).rejects.toMatchObject({ status: 409, response: { code: 'company_email_taken' } });

      await service.remove(first.company.id, ACTOR);
      await expect(
        service.create({ name: 'Other', email: 'hello@acme.test' }, ACTOR),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('rolls everything back when the admin cannot be provisioned', async () => {
      await save(User, { username: 'taken', passwordHash: 'x', email: 'old@acme.test' });

      await expect(
        service.create(
          { name: 'Ghost Inc', admin: { email: 'new@acme.test', username: 'taken' } },
          ACTOR,
        ),
      ).rejects.toMatchObject({ status: 409, response: { code: 'username_taken' } });

      expect(await dataSource.getRepository(Company).countBy({ name: 'Ghost Inc' })).toBe(0);
      expect(await dataSource.getRepository(CompanySettings).count()).toBe(0);
      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('audit-logs the creation with the acting user and company', async () => {
      const { company } = await service.create({ name: 'Acme' }, ACTOR);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: 'platform',
          event: 'company_created',
          userId: ACTOR,
          companyId: company.id,
        }),
        expect.any(String),
      );
    });
  });

  describe('table()', () => {
    it('counts live members, customers and channels per company', async () => {
      const acme = await save(Company, { name: 'Acme' });
      const beta = await save(Company, { name: 'Beta' });
      await addMember(acme, 'admin');
      await addMember(acme);
      const removed = await addMember(acme);
      await dataSource.getRepository(CompanyMember).softDelete(removed.member.id);

      await save(Customer, { companyId: acme.id, displayName: 'C1' });
      const c2 = await save(Customer, { companyId: acme.id, displayName: 'C2' });
      await dataSource.getRepository(Customer).softDelete(c2.id);
      await save(Customer, { companyId: beta.id, displayName: 'C3' });

      await save(Channel, {
        companyId: acme.id,
        type: 'whatsapp',
        name: 'main',
        externalAccountId: 'a1',
        credentials: '{}',
      });
      const gone = await save(Channel, {
        companyId: acme.id,
        type: 'whatsapp',
        name: 'old',
        externalAccountId: 'a2',
        credentials: '{}',
      });
      await dataSource.getRepository(Channel).softDelete(gone.id);

      const { items, meta } = await service.table(query({ sort: [{ id: 'name', desc: false }] }));

      expect(meta).toMatchObject({ totalItems: 2, itemCount: 2, currentPage: 1, totalPages: 1 });
      expect(items.map((c) => [c.name, c.membersCount, c.customersCount, c.channelsCount])).toEqual([
        ['Acme', 2, 1, 1],
        ['Beta', 0, 1, 0],
      ]);
    });

    it('hides soft-deleted companies unless asked, and shows their deletedAt', async () => {
      const live = await save(Company, { name: 'Live' });
      const dead = await save(Company, { name: 'Dead' });
      await addMember(dead);
      await dataSource.getRepository(Company).softDelete(dead.id);

      const hidden = await service.table(query());
      expect(hidden.items.map((c) => c.id)).toEqual([live.id]);
      expect(hidden.meta.totalItems).toBe(1);

      const shown = await service.table(
        query({ includeDeleted: true, sort: [{ id: 'name', desc: false }] }),
      );
      expect(shown.items.map((c) => [c.name, c.deletedAt !== null, c.membersCount])).toEqual([
        ['Dead', true, 1],
        ['Live', false, 0],
      ]);
      expect(shown.meta.totalItems).toBe(2);
    });

    it('filters by text and status, sorts by a count, and paginates', async () => {
      const big = await save(Company, { name: 'Big Corp', email: 'big@x.test' });
      await addMember(big);
      await addMember(big);
      await addMember(big);
      const mid = await save(Company, { name: 'Mid Corp' });
      await addMember(mid);
      await save(Company, { name: 'Tiny Corp' });
      await save(Company, { name: 'Paused', status: 'suspended' });

      const byCount = await service.table(
        query({ sort: [{ id: 'membersCount', desc: true }], perPage: 2 }),
      );
      expect(byCount.items.map((c) => c.name)).toEqual(['Big Corp', 'Mid Corp']);
      expect(byCount.meta).toMatchObject({ totalItems: 4, itemCount: 2, totalPages: 2 });

      const second = await service.table(
        query({ sort: [{ id: 'membersCount', desc: true }], perPage: 2, page: 2 }),
      );
      expect(second.items).toHaveLength(2);
      expect(second.meta.currentPage).toBe(2);

      expect((await service.table(query({ q: 'CORP' }))).meta.totalItems).toBe(3);
      expect((await service.table(query({ q: 'big@x' }))).items.map((c) => c.name)).toEqual([
        'Big Corp',
      ]);
      expect(
        (await service.table(query({ status: ['suspended'] }))).items.map((c) => c.name),
      ).toEqual(['Paused']);
    });

    it('answers an empty page with a full meta on an empty database', async () => {
      const result = await service.table(query());

      expect(result).toEqual({
        items: [],
        meta: { totalItems: 0, itemCount: 0, itemsPerPage: 10, totalPages: 0, currentPage: 1 },
      });
    });
  });

  describe('update()', () => {
    it('edits the profile fields without touching sessions', async () => {
      const company = await save(Company, { name: 'Acme' });
      await addMember(company);

      const row = await service.update(
        company.id,
        { name: 'Acme Inc', phoneNumber: '+51999000111', address: 'Lima' },
        ACTOR,
      );

      expect(row).toMatchObject({ name: 'Acme Inc', phoneNumber: '+51999000111', address: 'Lima' });
      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it.each(['suspended', 'inactive'] as const)(
      'revokes the sessions of every member when the status becomes %s',
      async (status) => {
        const company = await save(Company, { name: 'Acme' });
        const a = await addMember(company, 'admin');
        const b = await addMember(company);
        const other = await save(Company, { name: 'Other' });
        await addMember(other);

        const row = await service.update(company.id, { status }, ACTOR);

        expect(row.status).toBe(status);
        expect(revokedUsers()).toEqual([a.user.id, b.user.id].sort());
      },
    );

    it('also revokes when a company is reactivated, so members get it back in their token', async () => {
      const company = await save(Company, { name: 'Acme', status: 'suspended' });
      const a = await addMember(company);

      await service.update(company.id, { status: 'active' }, ACTOR);

      expect(revokedUsers()).toEqual([a.user.id]);
    });

    it('does not revoke when the status is sent but unchanged', async () => {
      const company = await save(Company, { name: 'Acme' });
      await addMember(company);

      await service.update(company.id, { status: 'active', name: 'Acme 2' }, ACTOR);

      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('answers 409 for another company email and 404 for unknown or deleted ids', async () => {
      const a = await save(Company, { name: 'A', email: 'a@x.test' });
      const b = await save(Company, { name: 'B', email: 'b@x.test' });

      await expect(service.update(b.id, { email: 'a@x.test' }, ACTOR)).rejects.toMatchObject({
        status: 409,
      });
      // Keeping its own email is fine.
      await expect(service.update(a.id, { email: 'a@x.test' }, ACTOR)).resolves.toBeDefined();
      await expect(service.update('nope', { name: 'X' }, ACTOR)).rejects.toMatchObject({
        status: 404,
      });

      await dataSource.getRepository(Company).softDelete(b.id);
      await expect(service.update(b.id, { name: 'X' }, ACTOR)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('accepts an empty patch', async () => {
      const company = await save(Company, { name: 'Acme' });

      await expect(service.update(company.id, {}, ACTOR)).resolves.toMatchObject({
        name: 'Acme',
      });
    });
  });

  describe('remove() and restore()', () => {
    it('soft deletes the company, revokes every member and reports how many lost access', async () => {
      const company = await save(Company, { name: 'Acme' });
      const a = await addMember(company, 'admin');
      const b = await addMember(company);
      const left = await addMember(company);
      await dataSource.getRepository(CompanyMember).softDelete(left.member.id);

      const result = await service.remove(company.id, ACTOR);

      // Removed members are not counted and not revoked: they already lost access.
      expect(result).toEqual({ affectedMembers: 2 });
      expect(revokedUsers()).toEqual([a.user.id, b.user.id].sort());

      const stored = await dataSource
        .getRepository(Company)
        .findOne({ where: { id: company.id }, withDeleted: true });
      expect(stored?.deletedAt).toBeInstanceOf(Date);
      // Members and their history stay; only the company is flagged.
      expect(await dataSource.getRepository(CompanyMember).countBy({ companyId: company.id })).toBe(2);
    });

    it('revokes each member only once', async () => {
      const company = await save(Company, { name: 'Acme' });
      await addMember(company);

      await service.remove(company.id, ACTOR);

      expect(sessions.revoke).toHaveBeenCalledTimes(1);
    });

    it('answers 404 for unknown ids and for companies already deleted', async () => {
      const company = await save(Company, { name: 'Acme' });

      await expect(service.remove('nope', ACTOR)).rejects.toMatchObject({ status: 404 });
      await service.remove(company.id, ACTOR);
      await expect(service.remove(company.id, ACTOR)).rejects.toMatchObject({ status: 404 });
    });

    it('restores a deleted company, revoking members so their token lists it again', async () => {
      const company = await save(Company, { name: 'Acme' });
      const member = await addMember(company);
      await service.remove(company.id, ACTOR);
      sessions.revoke.mockClear();

      const row = await service.restore(company.id, ACTOR);

      expect(row).toMatchObject({ id: company.id, deletedAt: null, membersCount: 1 });
      expect(revokedUsers()).toEqual([member.user.id]);
      expect((await service.table(query())).items.map((c) => c.id)).toEqual([company.id]);
    });

    it('is idempotent for a live company and 404 for unknown ids', async () => {
      const company = await save(Company, { name: 'Acme' });

      await expect(service.restore(company.id, ACTOR)).resolves.toMatchObject({ deletedAt: null });
      expect(sessions.revoke).not.toHaveBeenCalled();
      await expect(service.restore('nope', ACTOR)).rejects.toMatchObject({ status: 404 });
    });

    it('audit-logs deletion and restoration with user and company ids', async () => {
      const company = await save(Company, { name: 'Acme' });

      await service.remove(company.id, ACTOR);
      await service.restore(company.id, ACTOR);

      const events = logger.info.mock.calls.map(
        ([meta]) => meta as { event: string; userId: string; companyId: string },
      );
      expect(events.map((e) => [e.event, e.userId, e.companyId])).toEqual([
        ['company_deleted', ACTOR, company.id],
        ['company_restored', ACTOR, company.id],
      ]);
    });
  });
});
