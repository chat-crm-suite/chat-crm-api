// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import * as bcrypt from 'bcrypt';
import type { ClsService } from 'nestjs-cls';
import { DataSource, DataSourceOptions, IsNull } from 'typeorm';

import { MemoryRedis } from '@helpers/memory-redis';
import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from '@helpers/test-database.helper';
import {
  CLS_COMPANY_ID,
  CLS_MEMBER_ID,
  CLS_MEMBER_ROLE,
  CLS_USER_ID,
} from '../../config/cls.keys';
import {
  TeamTableQuerySchema,
  TeamTableResponseSchema,
  WorkspaceSocketEvent,
  type MemberRole,
  type MemberStatus,
  type TeamTableQuery,
} from '../../contracts/index';
import { WorkspaceChangedEvent } from '../../common/events/workspace-changed.event';
import { WorkspaceTableCache } from '../../common/cache/workspace-table-cache.service';
import { Channel } from '../channels/entities/channel.entity';
import { CompanySettings } from '../company/entities/company-settings.entity';
import { Company } from '../company/entities/company.entity';
import { ConversationAssignmentService } from '../conversations/assignment/conversation-assignment.service';
import { ConversationAssignment } from '../conversations/entities/conversation-assignment.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { MemberConversationsReleasedEvent } from '../conversations/events/member-conversations-released.event';
import { Customer } from '../customers/entities/customer.entity';
import { PresenceInterval } from '../presence/entities/presence-interval.entity';
import { PresenceService } from '../presence/presence.service';
import { User } from '../users/entities/user.entity';
import { CompanyMemberService } from './company-member.service';
import { CompanyMember } from './entities/company-member.entity';
import { MemberProvisioningService } from './member-provisioning.service';

jest.setTimeout(120_000);

const logger = { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

/**
 * Equipo on in-memory SQLite: token claims, the table (counts, filters, load,
 * presence, cache) and the mutations with their policy, session revocation and
 * conversation release.
 */
describe('CompanyMemberService (integration)', () => {
  let dataSource: DataSource;
  let service: CompanyMemberService;
  const redis = new MemoryRedis();
  const eventBus = { publish: jest.fn() };
  const sessions = { revoke: jest.fn() };
  const context = new Map<string, unknown>();
  const cls = { get: (key: string) => context.get(key) } as unknown as ClsService;
  let presence: PresenceService;
  let seq = 0;

  beforeAll(async () => {
    dataSource = new DataSource(
      getTestSQLiteConfig(getSQLiteEntities()) as DataSourceOptions,
    );
    await dataSource.initialize();

    presence = new PresenceService(
      dataSource.getRepository(PresenceInterval),
      redis as never,
      logger as never,
      eventBus as never,
    );
    service = new CompanyMemberService(
      dataSource.getRepository(CompanyMember),
      cls,
      dataSource,
      new MemberProvisioningService(),
      presence,
      new ConversationAssignmentService(dataSource, logger as never),
      sessions as never,
      new WorkspaceTableCache(redis as never, logger as never, eventBus as never),
      eventBus as never,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    redis.store.clear();
    redis.failing = false;
    eventBus.publish.mockClear();
    sessions.revoke.mockReset();
    context.clear();
    seq = 0;
  });

  // ---------------------------------------------------------------------------
  // Seeding
  // ---------------------------------------------------------------------------

  const seedCompany = () => {
    const companies = dataSource.getRepository(Company);
    return companies.save(companies.create({ name: `company-${++seq}` }));
  };

  const seedUser = (extra: Partial<User> = {}) => {
    const users = dataSource.getRepository(User);
    return users.save(
      users.create({
        username: `user-${++seq}`,
        passwordHash: '$2b$04$le0E9pls3D0fXBhXbv3aS.ejZsbJdrtuJIxiO0ov95jwoBVgaknaS',
        ...extra,
      }),
    );
  };

  const seedMember = async (
    company: Company,
    role: MemberRole,
    options: { status?: MemberStatus; user?: User; max?: number | null } = {},
  ) => {
    const user = options.user ?? (await seedUser());
    const members = dataSource.getRepository(CompanyMember);
    const member = await members.save(
      members.create({
        userId: user.id,
        companyId: company.id,
        role,
        status: options.status ?? 'active',
        maxOpenConversations: options.max ?? null,
      }),
    );
    return { member, user };
  };

  /** Calls from now on act as this member of this company. */
  const actAs = (company: Company, member: CompanyMember) => {
    context.set(CLS_COMPANY_ID, company.id);
    context.set(CLS_MEMBER_ID, member.id);
    context.set(CLS_MEMBER_ROLE, member.role);
    context.set(CLS_USER_ID, member.userId);
  };

  const seedConversation = async (
    company: Company,
    assigned: CompanyMember | null,
    status: Conversation['status'] = 'open',
  ) => {
    const channels = dataSource.getRepository(Channel);
    const channel =
      (await channels.findOne({ where: { companyId: company.id } })) ??
      (await channels.save(
        channels.create({
          companyId: company.id,
          type: 'whatsapp',
          name: 'main',
          externalAccountId: `acc-${++seq}`,
          credentials: '{}',
        }),
      ));
    const customers = dataSource.getRepository(Customer);
    const customer = await customers.save(
      customers.create({ companyId: company.id, displayName: `Cliente ${++seq}` }),
    );
    const conversations = dataSource.getRepository(Conversation);
    const conversation = await conversations.save(
      conversations.create({
        companyId: company.id,
        customerId: customer.id,
        channelId: channel.id,
        status,
        assignedMemberId: assigned?.id ?? null,
      }),
    );
    if (assigned) {
      const assignments = dataSource.getRepository(ConversationAssignment);
      await assignments.save(
        assignments.create({
          conversationId: conversation.id,
          memberId: assigned.id,
          reason: 'auto',
          assignedAt: new Date(),
        }),
      );
    }
    return conversation;
  };

  const query = (extra: Partial<TeamTableQuery> = {}): TeamTableQuery =>
    TeamTableQuerySchema.parse(extra);

  // ---------------------------------------------------------------------------
  // Token claims
  // ---------------------------------------------------------------------------

  describe('findActiveClaims', () => {
    it('lists every active membership with its member id and role', async () => {
      const user = await seedUser();
      const x = await seedCompany();
      const y = await seedCompany();
      const admin = await seedMember(x, 'admin', { user });
      const agent = await seedMember(y, 'agent', { user });

      const claims = await service.findActiveClaims(user.id);

      expect(claims).toHaveLength(2);
      expect(claims).toEqual(
        expect.arrayContaining([
          { cid: x.id, mid: admin.member.id, role: 'admin' },
          { cid: y.id, mid: agent.member.id, role: 'agent' },
        ]),
      );
    });

    it('leaves out inactive or suspended memberships', async () => {
      const user = await seedUser();
      const live = await seedCompany();
      const { member } = await seedMember(live, 'agent', { user });
      await seedMember(await seedCompany(), 'admin', { user, status: 'inactive' });
      await seedMember(await seedCompany(), 'supervisor', { user, status: 'suspended' });

      await expect(service.findActiveClaims(user.id)).resolves.toEqual([
        { cid: live.id, mid: member.id, role: 'agent' },
      ]);
    });

    it('leaves out soft-deleted members, soft-deleted and suspended companies', async () => {
      const user = await seedUser();
      const live = await seedCompany();
      const { member } = await seedMember(live, 'agent', { user });

      const deletedCompany = await seedCompany();
      await seedMember(deletedCompany, 'admin', { user });
      await dataSource.getRepository(Company).softDelete({ id: deletedCompany.id });

      const suspended = await seedCompany();
      await dataSource.getRepository(Company).update(suspended.id, { status: 'suspended' });
      await seedMember(suspended, 'admin', { user });

      const left = await seedCompany();
      const removed = await seedMember(left, 'agent', { user });
      await dataSource.getRepository(CompanyMember).softDelete(removed.member.id);

      await expect(service.findActiveClaims(user.id)).resolves.toEqual([
        { cid: live.id, mid: member.id, role: 'agent' },
      ]);
    });

    it('never returns another user memberships', async () => {
      const user = await seedUser();
      const other = await seedUser();
      await seedMember(await seedCompany(), 'admin', { user: other });

      await expect(service.findActiveClaims(user.id)).resolves.toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Table
  // ---------------------------------------------------------------------------

  describe('table', () => {
    it('answers an empty company with zeros and a parseable payload', async () => {
      const company = await seedCompany();
      const { member } = await seedMember(company, 'admin');
      await dataSource.getRepository(CompanyMember).softDelete(member.id);
      actAs(company, member);

      const result = await service.table(query());

      expect(result.items).toEqual([]);
      expect(result.meta).toMatchObject({
        totalItems: 0,
        itemCount: 0,
        totalPages: 0,
        currentPage: 1,
        counts: {
          byRole: { admin: 0, supervisor: 0, agent: 0 },
          byPresence: { available: 0, away: 0, offline: 0 },
        },
      });
      expect(() => TeamTableResponseSchema.parse(result)).not.toThrow();
    });

    it('returns rows with load, capacity (member override else company) and presence', async () => {
      const company = await seedCompany();
      await dataSource.getRepository(CompanySettings).save(
        dataSource
          .getRepository(CompanySettings)
          .create({ companyId: company.id, autoAssignMaxOpen: 5 }),
      );
      const admin = await seedMember(company, 'admin');
      const busy = await seedMember(company, 'agent', { max: 2 });
      const idle = await seedMember(company, 'agent');
      await seedConversation(company, busy.member, 'open');
      await seedConversation(company, busy.member, 'pending');
      await seedConversation(company, busy.member, 'closed');
      await seedConversation(company, admin.member, 'open');
      await presence.connected(company.id, busy.member.id);
      actAs(company, admin.member);

      const result = await service.table(query({ sort: [{ id: 'openConversations', desc: true }] }));

      expect(() => TeamTableResponseSchema.parse(result)).not.toThrow();
      expect(result.items.map((row) => row.id)).toEqual([
        busy.member.id,
        admin.member.id,
        idle.member.id,
      ]);
      const [first, , last] = result.items;
      expect(first).toMatchObject({
        openConversations: 2,
        capacity: 2,
        presence: { state: 'available' },
        username: busy.user.username,
      });
      expect(last).toMatchObject({
        openConversations: 0,
        capacity: 5,
        presence: { state: 'offline' },
      });
      expect(result.meta.counts.byPresence).toEqual({ available: 1, away: 0, offline: 2 });
      expect(result.meta.counts.byRole).toEqual({ admin: 1, supervisor: 0, agent: 2 });
    });

    it('filters by role, status, text and presence, while counts ignore filters', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      const ana = await seedMember(company, 'agent', {
        user: await seedUser({ username: 'ana', firstName: 'Ana', email: 'ana@acme.test' }),
      });
      await seedMember(company, 'agent', {
        status: 'suspended',
        user: await seedUser({ username: 'beto' }),
      });
      await seedMember(company, 'supervisor');
      await presence.connected(company.id, ana.member.id);
      actAs(company, admin.member);

      const byRole = await service.table(query({ role: ['agent'] }));
      expect(byRole.meta.totalItems).toBe(2);
      expect(byRole.meta.counts.byRole).toEqual({ admin: 1, supervisor: 1, agent: 2 });

      const byStatus = await service.table(query({ status: ['suspended'] }));
      expect(byStatus.items.map((row) => row.username)).toEqual(['beto']);

      const byText = await service.table(query({ q: 'ana@acme' }));
      expect(byText.items.map((row) => row.id)).toEqual([ana.member.id]);

      const online = await service.table(query({ presence: ['available'] }));
      expect(online.items.map((row) => row.id)).toEqual([ana.member.id]);
      expect(online.meta.counts.byPresence.offline).toBe(3);

      const nobodyAway = await service.table(query({ presence: ['away'] }));
      expect(nobodyAway.items).toEqual([]);
      expect(nobodyAway.meta.totalItems).toBe(0);
    });

    it('sorts by whitelisted columns only and pages the result', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin', {
        user: await seedUser({ username: 'a-admin' }),
      });
      await seedMember(company, 'agent', { user: await seedUser({ username: 'b-agent' }) });
      await seedMember(company, 'agent', { user: await seedUser({ username: 'c-agent' }) });
      actAs(company, admin.member);

      const desc = await service.table(query({ sort: [{ id: 'username', desc: true }] }));
      expect(desc.items.map((row) => row.username)).toEqual(['c-agent', 'b-agent', 'a-admin']);

      // An unknown column never reaches SQL.
      const injected = await service.table(
        query({ sort: [{ id: 'username; DROP TABLE users', desc: false }] }),
      );
      expect(injected.items).toHaveLength(3);

      const second = await service.table(query({ perPage: 2, page: 2 }));
      expect(second.items.map((row) => row.username)).toEqual(['c-agent']);
      expect(second.meta).toMatchObject({ totalItems: 3, totalPages: 2, currentPage: 2, itemCount: 1 });
    });

    it('never shows other companies or removed members', async () => {
      const company = await seedCompany();
      const other = await seedCompany();
      const admin = await seedMember(company, 'admin');
      const gone = await seedMember(company, 'agent');
      await seedMember(other, 'agent');
      await dataSource.getRepository(CompanyMember).softDelete(gone.member.id);
      actAs(company, admin.member);

      const result = await service.table(query());

      expect(result.items.map((row) => row.id)).toEqual([admin.member.id]);
      expect(result.meta.counts.byRole).toEqual({ admin: 1, supervisor: 0, agent: 0 });
    });

    it('serves pages from Redis until a mutation, and reads presence live', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      const agent = await seedMember(company, 'agent');
      actAs(company, admin.member);

      const first = await service.table(query());
      // Changed behind the service's back: the cached page does not see it...
      await dataSource.getRepository(User).update(agent.user.id, { firstName: 'Zoe' });
      const cached = await service.table(query());
      expect(cached.items.find((row) => row.id === agent.member.id)?.firstName).toBeNull();
      expect(first.items).toHaveLength(2);

      // ...but presence is never cached.
      expect(cached.items.find((row) => row.id === agent.member.id)?.presence.state).toBe('offline');
      await presence.connected(company.id, agent.member.id);
      const live = await service.table(query());
      expect(live.items.find((row) => row.id === agent.member.id)?.presence.state).toBe('available');
      expect(live.meta.counts.byPresence.available).toBe(1);

      // A mutation bumps the version, so the next read recomputes.
      await service.update(agent.member.id, { acceptsAutoAssign: false });
      const fresh = await service.table(query());
      expect(fresh.items.find((row) => row.id === agent.member.id)).toMatchObject({
        firstName: 'Zoe',
        acceptsAutoAssign: false,
      });
    });

    it('keeps working when Redis is down', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      actAs(company, admin.member);
      redis.failing = true;

      const result = await service.table(query());
      expect(result.items).toHaveLength(1);

      const created = await service.create({ email: 'new@acme.test', role: 'agent' });
      expect(created.outcome).toBe('created');
    });
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  describe('create', () => {
    it('creates the account with a one-time password, audits the creator and revokes sessions', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      actAs(company, admin.member);

      const result = await service.create({
        email: 'Ana.Lopez@Acme.test',
        role: 'agent',
        firstName: 'Ana',
      });

      expect(result.outcome).toBe('created');
      expect(result.initialPassword).toHaveLength(14);
      expect(result.member).toMatchObject({
        role: 'agent',
        status: 'active',
        firstName: 'Ana',
        email: 'ana.lopez@acme.test',
        presence: { state: 'offline' },
      });
      const stored = await dataSource
        .getRepository(CompanyMember)
        .findOneByOrFail({ id: result.member.id });
      expect(stored.createdByMemberId).toBe(admin.member.id);
      expect(sessions.revoke).toHaveBeenCalledWith(result.member.userId);
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: company.id,
          event: WorkspaceSocketEvent.TeamChanged,
        }),
      );
    });

    it('links an existing account by email without a password', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      const existing = await seedUser({ email: 'ana@acme.test' });
      actAs(company, admin.member);

      const result = await service.create({ email: 'ana@acme.test', role: 'supervisor' });

      expect(result.outcome).toBe('linked');
      expect(result.initialPassword).toBeUndefined();
      expect(result.member.userId).toBe(existing.id);
      expect(sessions.revoke).toHaveBeenCalledWith(existing.id);
    });

    it('restores a removed member instead of duplicating it', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      const gone = await seedMember(company, 'agent', {
        user: await seedUser({ email: 'back@acme.test' }),
      });
      actAs(company, admin.member);
      await service.remove(gone.member.id);

      const result = await service.create({ email: 'back@acme.test', role: 'supervisor' });

      expect(result.outcome).toBe('restored');
      expect(result.member.id).toBe(gone.member.id);
      expect(result.member.role).toBe('supervisor');
      expect(await dataSource.getRepository(CompanyMember).count({ where: { companyId: company.id } })).toBe(2);
    });

    it('rejects an account that already belongs to the company', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      await seedMember(company, 'agent', { user: await seedUser({ email: 'dup@acme.test' }) });
      actAs(company, admin.member);

      await expect(
        service.create({ email: 'dup@acme.test', role: 'agent' }),
      ).rejects.toMatchObject({ response: { code: 'member_exists' } });
    });

    it('lets a supervisor add agents but not other roles; agents add nobody', async () => {
      const company = await seedCompany();
      const supervisor = await seedMember(company, 'supervisor');
      const agent = await seedMember(company, 'agent');

      actAs(company, supervisor.member);
      await expect(service.create({ email: 'a@acme.test', role: 'agent' })).resolves.toMatchObject({
        outcome: 'created',
      });
      await expect(service.create({ email: 'b@acme.test', role: 'admin' })).rejects.toMatchObject({
        status: 403,
      });
      await expect(service.create({ email: 'c@acme.test', role: 'supervisor' })).rejects.toMatchObject({
        status: 403,
      });

      actAs(company, agent.member);
      await expect(service.create({ email: 'd@acme.test', role: 'agent' })).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  describe('update', () => {
    it('revokes sessions when role or status change, not for plain settings', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      const agent = await seedMember(company, 'agent');
      actAs(company, admin.member);

      await service.update(agent.member.id, { acceptsAutoAssign: false, maxOpenConversations: 3 });
      expect(sessions.revoke).not.toHaveBeenCalled();

      const edited = await service.update(agent.member.id, { role: 'supervisor' });
      expect(edited.role).toBe('supervisor');
      expect(sessions.revoke).toHaveBeenCalledWith(agent.user.id);

      sessions.revoke.mockClear();
      const suspended = await service.update(agent.member.id, { status: 'suspended' });
      expect(suspended.status).toBe('suspended');
      expect(sessions.revoke).toHaveBeenCalledTimes(1);
    });

    it('applies supervisor limits and refuses self-service', async () => {
      const company = await seedCompany();
      const supervisor = await seedMember(company, 'supervisor');
      const other = await seedMember(company, 'supervisor');
      const admin = await seedMember(company, 'admin');
      const agent = await seedMember(company, 'agent');
      actAs(company, supervisor.member);

      await expect(
        service.update(agent.member.id, { acceptsAutoAssign: false }),
      ).resolves.toMatchObject({ acceptsAutoAssign: false });
      await expect(service.update(agent.member.id, { role: 'supervisor' })).rejects.toMatchObject({
        status: 403,
      });
      await expect(service.update(other.member.id, { status: 'suspended' })).rejects.toMatchObject({
        status: 403,
      });
      await expect(service.update(admin.member.id, { status: 'suspended' })).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        service.update(supervisor.member.id, { acceptsAutoAssign: false }),
      ).rejects.toMatchObject({ response: { code: 'team_self' } });

      actAs(company, admin.member);
      await expect(
        service.update(admin.member.id, { role: 'agent' }),
      ).rejects.toMatchObject({ response: { code: 'team_self' } });
    });

    it('never demotes or suspends the last active admin', async () => {
      const company = await seedCompany();
      const lone = await seedMember(company, 'admin');
      // A caller whose own admin row is no longer active (its token is stale):
      // the policy lets it through, the transaction check must still hold.
      const stale = await seedMember(company, 'admin', { status: 'suspended' });
      actAs(company, stale.member);

      await expect(service.update(lone.member.id, { role: 'agent' })).rejects.toMatchObject({
        status: 409,
        response: { code: 'last_admin' },
      });
      await expect(service.update(lone.member.id, { status: 'suspended' })).rejects.toMatchObject({
        status: 409,
        response: { code: 'last_admin' },
      });
      // Edits that keep the admin active are fine.
      await expect(
        service.update(lone.member.id, { acceptsAutoAssign: false }),
      ).resolves.toMatchObject({ role: 'admin', status: 'active' });

      // With a second active admin the first one can be demoted.
      await seedMember(company, 'admin');
      await expect(service.update(lone.member.id, { role: 'agent' })).resolves.toMatchObject({
        role: 'agent',
      });
    });

    it('edits identity only for single-company accounts', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      const solo = await seedMember(company, 'agent');
      const shared = await seedMember(company, 'agent');
      await seedMember(await seedCompany(), 'agent', { user: shared.user });
      actAs(company, admin.member);

      const renamed = await service.update(solo.member.id, {
        firstName: 'Sol',
        lastName: 'Rojas',
        phoneNumber: '+51999000111',
      });
      expect(renamed).toMatchObject({ firstName: 'Sol', lastName: 'Rojas', phoneNumber: '+51999000111' });

      await expect(service.update(shared.member.id, { firstName: 'Nope' })).rejects.toMatchObject({
        status: 409,
        response: { code: 'shared_account' },
      });
      // Non-identity edits on a shared account are fine.
      await expect(
        service.update(shared.member.id, { acceptsAutoAssign: false }),
      ).resolves.toBeDefined();

      const taken = await seedMember(company, 'agent');
      await expect(
        service.update(taken.member.id, { phoneNumber: '+51999000111' }),
      ).rejects.toMatchObject({ response: { code: 'phone_taken' } });
    });

    it('returns 404 for a member of another company', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      const foreign = await seedMember(await seedCompany(), 'agent');
      actAs(company, admin.member);

      await expect(service.update(foreign.member.id, { role: 'admin' })).rejects.toMatchObject({
        status: 404,
      });
      await expect(service.remove(foreign.member.id)).rejects.toMatchObject({ status: 404 });
      await expect(service.resetPassword(foreign.member.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  // ---------------------------------------------------------------------------
  // Remove
  // ---------------------------------------------------------------------------

  describe('remove', () => {
    it('soft deletes the member, releases its open conversations and revokes sessions', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      const agent = await seedMember(company, 'agent');
      const open = await seedConversation(company, agent.member, 'open');
      const pending = await seedConversation(company, agent.member, 'pending');
      const closed = await seedConversation(company, agent.member, 'closed');
      actAs(company, admin.member);

      const result = await service.remove(agent.member.id);

      expect(result).toEqual({ releasedConversations: 2 });
      const conversations = dataSource.getRepository(Conversation);
      expect((await conversations.findOneByOrFail({ id: open.id })).assignedMemberId).toBeNull();
      expect((await conversations.findOneByOrFail({ id: pending.id })).assignedMemberId).toBeNull();
      expect((await conversations.findOneByOrFail({ id: closed.id })).assignedMemberId).toBe(
        agent.member.id,
      );
      expect(
        await dataSource.getRepository(ConversationAssignment).count({
          where: { memberId: agent.member.id, unassignedAt: IsNull() },
        }),
      ).toBe(1);

      // The row survives, soft-deleted, and leaves every staff list.
      expect(
        await dataSource.getRepository(CompanyMember).findOne({ where: { id: agent.member.id } }),
      ).toBeNull();
      const archived = await dataSource
        .getRepository(CompanyMember)
        .findOne({ where: { id: agent.member.id }, withDeleted: true });
      expect(archived?.deletedAt).toBeInstanceOf(Date);
      expect((await service.list({ limit: 50 })).map((row) => row.id)).toEqual([admin.member.id]);
      expect(await service.findActiveClaims(agent.user.id)).toEqual([]);

      expect(sessions.revoke).toHaveBeenCalledWith(agent.user.id);
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.any(MemberConversationsReleasedEvent),
      );
      const released = eventBus.publish.mock.calls
        .map(([event]: [unknown]) => event)
        .filter(
          (event): event is MemberConversationsReleasedEvent =>
            event instanceof MemberConversationsReleasedEvent,
        )[0];
      expect([...(released?.conversationIds ?? [])].sort()).toEqual([open.id, pending.id].sort());
      expect(
        eventBus.publish.mock.calls.some(
          ([event]: [unknown]) =>
            event instanceof WorkspaceChangedEvent && event.event === WorkspaceSocketEvent.TeamChanged,
        ),
      ).toBe(true);
    });

    it('does not announce a release when there was nothing to release', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      const agent = await seedMember(company, 'agent');
      actAs(company, admin.member);

      await expect(service.remove(agent.member.id)).resolves.toEqual({ releasedConversations: 0 });
      expect(
        eventBus.publish.mock.calls.some(([event]: [unknown]) => event instanceof MemberConversationsReleasedEvent),
      ).toBe(false);
    });

    it('refuses to delete yourself or the last active admin', async () => {
      const company = await seedCompany();
      const lone = await seedMember(company, 'admin');
      const stale = await seedMember(company, 'admin', { status: 'suspended' });

      actAs(company, lone.member);
      await expect(service.remove(lone.member.id)).rejects.toMatchObject({
        response: { code: 'team_self' },
      });

      actAs(company, stale.member);
      await expect(service.remove(lone.member.id)).rejects.toMatchObject({
        status: 409,
        response: { code: 'last_admin' },
      });
      expect(
        await dataSource.getRepository(CompanyMember).exists({ where: { id: lone.member.id } }),
      ).toBe(true);
      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('lets a supervisor remove agents only', async () => {
      const company = await seedCompany();
      const supervisor = await seedMember(company, 'supervisor');
      const agent = await seedMember(company, 'agent');
      const admin = await seedMember(company, 'admin');
      actAs(company, supervisor.member);

      await expect(service.remove(admin.member.id)).rejects.toMatchObject({ status: 403 });
      await expect(service.remove(agent.member.id)).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Reset password
  // ---------------------------------------------------------------------------

  describe('resetPassword', () => {
    it('stores a new hashed password, returns it once and revokes sessions', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, 'admin');
      const agent = await seedMember(company, 'agent');
      actAs(company, admin.member);

      const { password } = await service.resetPassword(agent.member.id);

      expect(password).toHaveLength(14);
      const stored = await dataSource.getRepository(User).findOneByOrFail({ id: agent.user.id });
      expect(await bcrypt.compare(password, stored.passwordHash)).toBe(true);
      expect(sessions.revoke).toHaveBeenCalledWith(agent.user.id);
    });

    it('follows the same policy: no self, supervisors only on agents', async () => {
      const company = await seedCompany();
      const supervisor = await seedMember(company, 'supervisor');
      const admin = await seedMember(company, 'admin');
      const agent = await seedMember(company, 'agent');
      actAs(company, supervisor.member);

      await expect(service.resetPassword(admin.member.id)).rejects.toMatchObject({ status: 403 });
      await expect(service.resetPassword(supervisor.member.id)).rejects.toMatchObject({
        response: { code: 'team_self' },
      });
      await expect(service.resetPassword(agent.member.id)).resolves.toHaveProperty('password');
    });
  });
});
