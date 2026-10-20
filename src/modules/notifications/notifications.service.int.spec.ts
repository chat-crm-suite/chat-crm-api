// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { PinoLogger } from 'nestjs-pino';
import { DataSource, DataSourceOptions } from 'typeorm';

import { inlineNotifications } from '@helpers/inline-notifications';
import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from '@helpers/test-database.helper';
import {
  NotificationDeliveredEvent,
  NotificationsReadEvent,
} from '../../common/events/notification-realtime.event';
import { NOTIFICATION_TYPES, type MemberRole } from '../../contracts/index';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { Company } from '../company/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { Notification } from './entities/notification.entity';
import type { NotifyInput } from './notification.types';

jest.setTimeout(60_000);

const logger = {
  setContext: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
} as unknown as PinoLogger;

/** Notification pipeline (delivery + read side) on in-memory SQLite. */
describe('Notifications (integration)', () => {
  let dataSource: DataSource;
  let pipeline: ReturnType<typeof inlineNotifications>;
  let company: Company;
  let agent: CompanyMember;
  let supervisor: CompanyMember;
  let admin: CompanyMember;
  let seq = 0;

  const newMember = async (role: MemberRole, companyId = company.id) => {
    const users = dataSource.getRepository(User);
    const user = await users.save(users.create({ username: `u-${++seq}`, passwordHash: 'x' }));
    const members = dataSource.getRepository(CompanyMember);
    return members.save(members.create({ companyId, userId: user.id, role }));
  };

  const input = (overrides: Partial<NotifyInput> = {}): NotifyInput => ({
    companyId: company.id,
    type: 'conversation_assigned',
    audience: { memberIds: [agent.id] },
    title: 'Nuevo chat asignado',
    body: 'Ana espera tu respuesta',
    data: { conversationId: 'conv-1' },
    dedupeKey: `k-${++seq}`,
    ...overrides,
  });

  const rows = () => dataSource.getRepository(Notification).find({ order: { createdAt: 'ASC' } });
  const delivered = () =>
    pipeline.published.filter(
      (event): event is NotificationDeliveredEvent => event instanceof NotificationDeliveredEvent,
    );

  beforeAll(async () => {
    dataSource = new DataSource(getTestSQLiteConfig(getSQLiteEntities()) as DataSourceOptions);
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    pipeline = inlineNotifications(dataSource, null, logger);
    const companies = dataSource.getRepository(Company);
    company = await companies.save(companies.create({ name: 'Acme' }));
    agent = await newMember('agent');
    supervisor = await newMember('supervisor');
    admin = await newMember('admin');
  });

  describe('delivery', () => {
    it('stores one row and relays it with the badge to the recipient user only', async () => {
      await pipeline.delivery.deliver(input());

      const [row] = await rows();
      expect(row).toMatchObject({ recipientMemberId: agent.id, type: 'conversation_assigned', severity: 'info', count: 1 });

      const [event] = delivered();
      expect(event.userId).toBe(agent.userId);
      expect(event.kind).toBe('new');
      expect(event.payload).toMatchObject({
        unreadCount: 1,
        notification: { id: row.id, companyId: company.id, data: { conversationId: 'conv-1' } },
      });
    });

    it('delivers the same event once, even when published twice', async () => {
      const once = input({ dedupeKey: 'assigned:conv-1:a1' });

      await pipeline.delivery.deliver(once);
      const second = await pipeline.delivery.deliver(once);

      expect(second.get(agent.id)).toBe('duplicate');
      expect(await rows()).toHaveLength(1);
      expect(delivered()).toHaveLength(1);
    });

    it('still delivers (no dedupe window) when Redis is down', async () => {
      pipeline.redis.failing = true;

      await pipeline.delivery.deliver(input());

      expect(await rows()).toHaveLength(1);
      expect(delivered()[0].payload.unreadCount).toBe(1);
    });

    it('collapses unread rows of a group: count grows, one row, `updated` event', async () => {
      const queued = (conversationId: string) =>
        input({
          type: 'queue_unassigned',
          audience: { roles: ['admin', 'supervisor'] },
          groupKey: 'queue',
          data: { conversationId },
        });

      await pipeline.delivery.deliver(queued('c1'));
      await pipeline.delivery.deliver(queued('c2'));
      await pipeline.delivery.deliver(queued('c3'));

      const stored = await rows();
      expect(stored).toHaveLength(2); // supervisor + admin
      expect(stored.every((row) => row.count === 3)).toBe(true);
      expect(stored[0].data).toEqual({ conversationId: 'c3' });
      expect(delivered().map((event) => event.kind)).toEqual(['new', 'new', 'updated', 'updated', 'updated', 'updated']);
      expect(delivered().every((event) => event.payload.unreadCount === 1)).toBe(true);
    });

    it('starts a new group row once the previous one was read', async () => {
      const queued = () =>
        input({ type: 'queue_unassigned', audience: { memberIds: [supervisor.id] }, groupKey: 'queue' });

      await pipeline.delivery.deliver(queued());
      await pipeline.service.markAllRead({ memberId: supervisor.id, userId: supervisor.userId, companyId: company.id });
      await pipeline.delivery.deliver(queued());

      expect((await rows()).map((row) => row.count)).toEqual([1, 1]);
    });

    it('never widens the audience beyond the roles allowed for the type', async () => {
      await pipeline.delivery.deliver(
        input({ type: 'queue_unassigned', audience: { memberIds: [agent.id, supervisor.id] } }),
      );
      await pipeline.delivery.deliver(
        input({ type: 'spend_budget', audience: { roles: ['admin', 'supervisor', 'agent'] } }),
      );

      const stored = await rows();
      expect(stored.map((row) => [row.type, row.recipientMemberId])).toEqual([
        ['queue_unassigned', supervisor.id],
        ['spend_budget', admin.id],
      ]);
    });

    it('skips the actor, inactive members and other companies', async () => {
      const inactive = await newMember('supervisor');
      await dataSource.getRepository(CompanyMember).update(inactive.id, { status: 'inactive' });
      const otherCompany = await dataSource
        .getRepository(Company)
        .save(dataSource.getRepository(Company).create({ name: 'Other' }));
      await newMember('admin', otherCompany.id);

      await pipeline.delivery.deliver(
        input({
          type: 'queue_unassigned',
          audience: { roles: ['admin', 'supervisor'] },
          excludeMemberIds: [admin.id],
        }),
      );

      expect((await rows()).map((row) => row.recipientMemberId)).toEqual([supervisor.id]);
    });

    it('stores nothing for a member who muted the type, and keeps delivering to others', async () => {
      await pipeline.service.setPreferences(supervisor.id, { muted: ['queue_unassigned'], desktop: [] });

      const outcomes = await pipeline.delivery.deliver(
        input({ type: 'queue_unassigned', audience: { roles: ['admin', 'supervisor'] } }),
      );

      expect(outcomes.get(supervisor.id)).toBe('muted');
      expect((await rows()).map((row) => row.recipientMemberId)).toEqual([admin.id]);
    });
  });

  describe('read side', () => {
    const reader = () => ({ memberId: agent.id, userId: agent.userId, companyId: company.id });

    it('lists latest activity first with the badge, and pages with `before`', async () => {
      for (let i = 0; i < 5; i++) await pipeline.delivery.deliver(input({ title: `n${i}` }));

      const first = await pipeline.service.list(reader(), { limit: 3 });
      expect(first.items.map((item) => item.title)).toEqual(['n4', 'n3', 'n2']);
      expect(first.unreadCount).toBe(5);
      expect(first.nextCursor).toBe(first.items[2].id);

      const second = await pipeline.service.list(reader(), { limit: 3, before: first.nextCursor! });
      expect(second.items.map((item) => item.title)).toEqual(['n1', 'n0']);
      expect(second.nextCursor).toBeNull();
    });

    it('replays with `after` what changed since a row, including a grouped row that grew', async () => {
      const grouped = () => input({ groupKey: 'conversation:c1', title: 'grouped' });
      await pipeline.delivery.deliver(grouped());
      await pipeline.delivery.deliver(input({ title: 'seen' }));
      const seen = (await pipeline.service.list(reader(), { limit: 1 })).items[0];

      await pipeline.delivery.deliver(grouped());
      await pipeline.delivery.deliver(input({ title: 'missed' }));

      const replay = await pipeline.service.list(reader(), { limit: 20, after: seen.id });
      expect(replay.items.map((item) => [item.title, item.count])).toEqual([
        ['missed', 1],
        ['grouped', 2],
      ]);
    });

    it('marks one read, recounts, and echoes it to the reader user', async () => {
      await pipeline.delivery.deliver(input());
      await pipeline.delivery.deliver(input());
      const [row] = await rows();

      await expect(pipeline.service.markRead(reader(), row.id)).resolves.toEqual({ unreadCount: 1 });
      await expect(pipeline.service.unreadCount(agent.id)).resolves.toBe(1);

      const echo = pipeline.published.find(
        (event): event is NotificationsReadEvent => event instanceof NotificationsReadEvent,
      );
      expect(echo).toMatchObject({
        userId: agent.userId,
        payload: { companyId: company.id, ids: [row.id], unreadCount: 1 },
      });
    });

    it("refuses to mark someone else's notification", async () => {
      await pipeline.delivery.deliver(input({ audience: { memberIds: [supervisor.id] } }));
      const [row] = await rows();

      await expect(pipeline.service.markRead(reader(), row.id)).rejects.toThrow(/not found/i);
    });

    it('marks all read and serves a cached badge that follows writes', async () => {
      await pipeline.delivery.deliver(input());
      await pipeline.delivery.deliver(input());
      await expect(pipeline.service.unreadCount(agent.id)).resolves.toBe(2);

      await expect(pipeline.service.markAllRead(reader())).resolves.toEqual({ unreadCount: 0 });
      await expect(pipeline.service.unreadCount(agent.id)).resolves.toBe(0);
    });
  });

  describe('preferences', () => {
    it('defaults for a member who never chose, including legacy `{ muted }` rows', async () => {
      const defaults = {
        muted: [],
        desktop: ['conversation_assigned', 'conversation_message', 'task_assigned'],
      };
      await expect(pipeline.service.getPreferences(agent.id)).resolves.toEqual(defaults);

      await dataSource
        .getRepository(CompanyMember)
        .update(agent.id, { notificationPrefs: { muted: ['spend_budget'] } as never });
      await expect(pipeline.service.getPreferences(agent.id)).resolves.toEqual({
        ...defaults,
        muted: ['spend_budget'],
      });
    });

    it('round-trips through the json column, deduplicated', async () => {
      const saved = await pipeline.service.setPreferences(agent.id, {
        muted: ['spend_budget', 'spend_budget', 'queue_unassigned'],
        desktop: ['task_due', 'task_due'],
      });

      expect(saved).toEqual({ muted: ['spend_budget', 'queue_unassigned'], desktop: ['task_due'] });
      await expect(pipeline.service.getPreferences(agent.id)).resolves.toEqual(saved);
    });

    it('accepts every type', async () => {
      await pipeline.service.setPreferences(agent.id, { muted: [...NOTIFICATION_TYPES], desktop: [] });
      for (const type of NOTIFICATION_TYPES) {
        const outcomes = await pipeline.delivery.deliver(input({ type, audience: { memberIds: [agent.id] } }));
        expect([...outcomes.values()].every((outcome) => outcome === 'muted')).toBe(true);
      }
    });
  });
});
