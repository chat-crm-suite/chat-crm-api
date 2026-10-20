// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { PinoLogger } from 'nestjs-pino';
import { DataSource, DataSourceOptions } from 'typeorm';

import { ChannelStatusChangedEvent } from '@common/events/channel-status-changed.event';
import { inboxSeed } from '@helpers/inbox-seed';
import { inlineNotifications } from '@helpers/inline-notifications';
import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from '@helpers/test-database.helper';
import { IaStatusChangedEvent } from '../../analytics/events/analytics.events';
import type { CompanyMember } from '../../company-members/entities/company-member.entity';
import type { Company } from '../../company/entities/company.entity';
import { ConversationAssignmentService } from '../../conversations/assignment/conversation-assignment.service';
import { MessageSavedEvent } from '../../conversations/events/message-saved.event';
import {
  ConversationMessageNoticeHandler,
  messagePreview,
} from '../../conversations/realtime/conversation-message-notice.handler';
import { Message } from '../../message/entities/message.entity';
import { Task } from '../../tasks/entities/task.entity';
import { DUE_SOON_MS, TaskDueScanner } from '../../tasks/task-due.scanner';
import { Notification } from '../entities/notification.entity';
import { ChannelDownNoticeHandler, IaDownNoticeHandler } from './system-notices.handlers';

jest.setTimeout(60_000);

const logger = {
  setContext: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
} as unknown as PinoLogger;

/** Phase 2 producers end to end through the inline pipeline, on SQLite. */
describe('Notification producers (integration)', () => {
  let dataSource: DataSource;
  let seed: ReturnType<typeof inboxSeed>;
  let pipeline: ReturnType<typeof inlineNotifications>;
  let company: Company;
  let admin: CompanyMember;
  let agent: CompanyMember;
  let msgSeq = 0;

  const rows = () =>
    dataSource.getRepository(Notification).find({ order: { createdAt: 'ASC', id: 'ASC' } });

  beforeAll(async () => {
    dataSource = new DataSource(getTestSQLiteConfig(getSQLiteEntities()) as DataSourceOptions);
    await dataSource.initialize();
    seed = inboxSeed(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    pipeline = inlineNotifications(dataSource, null, logger);
    company = await seed.company();
    admin = await seed.member(company, 'admin');
    agent = await seed.member(company, 'agent');
  });

  describe('conversation_message', () => {
    const handler = () =>
      new ConversationMessageNoticeHandler(
        pipeline.dispatcher,
        new ConversationAssignmentService(dataSource, logger),
        dataSource,
        logger,
      );

    const inbound = (conversationId: string, overrides: Partial<Message> = {}) =>
      new MessageSavedEvent(
        dataSource.getRepository(Message).create({
          id: `m-${++msgSeq}`,
          conversationId,
          senderType: 'customer',
          type: 'text',
          body: `hola ${msgSeq}`,
          createdAt: new Date(),
          ...overrides,
        }),
        company.id,
      );

    it('one grouped notice per chat for its assignee, latest message as body', async () => {
      const { conversation, customer } = await seed.conversation(company, { assignee: agent });

      await handler().handle(inbound(conversation.id, { body: 'Hola' }));
      await handler().handle(inbound(conversation.id, { body: '¿Siguen ahí?' }));

      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        type: 'conversation_message',
        recipientMemberId: agent.id,
        title: customer.displayName,
        body: '¿Siguen ahí?',
        count: 2,
        groupKey: `conversation:${conversation.id}`,
      });
    });

    it('stays quiet for unassigned chats, reactions, our own messages and a fresh assignment', async () => {
      const { conversation: queued } = await seed.conversation(company);
      const { conversation: mine } = await seed.conversation(company, { assignee: agent });

      await handler().handle(inbound(queued.id));
      await handler().handle(inbound(mine.id, { type: 'reaction', body: '👍' }));
      await handler().handle(inbound(mine.id, { senderType: 'member' }));
      // The assignment (60 s ago) is newer than this message's grace window.
      await handler().handle(inbound(mine.id, { createdAt: new Date(Date.now() - 55_000) }));

      expect(await rows()).toHaveLength(0);
    });

    it('labels media without caption and trims long text', () => {
      expect(messagePreview({ type: 'image', body: null })).toBe('Imagen');
      expect(messagePreview({ type: 'text', body: 'x'.repeat(300) })).toHaveLength(140);
    });

    it('opening the chat reads its assignment and message notices, not other chats', async () => {
      const { conversation } = await seed.conversation(company, { assignee: agent });
      const { conversation: other } = await seed.conversation(company, { assignee: agent });
      const groupKey = `conversation:${conversation.id}`;
      await pipeline.delivery.deliver({
        companyId: company.id,
        type: 'conversation_assigned',
        audience: { memberIds: [agent.id] },
        title: 'Nuevo chat asignado',
        data: { conversationId: conversation.id },
        dedupeKey: 'assigned:1',
        groupKey,
      });
      await handler().handle(inbound(conversation.id));
      await handler().handle(inbound(other.id));

      // Same group, different types: two rows, never merged.
      expect((await rows()).filter((row) => row.groupKey === groupKey)).toHaveLength(2);

      const reader = { memberId: agent.id, userId: agent.userId, companyId: company.id };
      await expect(
        pipeline.service.markAllRead(reader, { conversationId: conversation.id }),
      ).resolves.toEqual({ unreadCount: 1 });

      const left = (await rows()).filter((row) => !row.readAt);
      expect(left.map((row) => row.groupKey)).toEqual([`conversation:${other.id}`]);
    });
  });

  describe('task_due', () => {
    const task = (dueAt: Date, overrides: Partial<Task> = {}) =>
      seed.save(Task, {
        companyId: company.id,
        title: `Llamar ${dueAt.toISOString()}`,
        status: 'open',
        priority: 'medium',
        dueAt,
        assigneeMemberId: agent.id,
        ...overrides,
      });

    it('warns once before the deadline and once after, only inside the windows', async () => {
      const now = new Date('2026-10-20T12:00:00Z');
      const minute = 60_000;
      await task(new Date(now.getTime() + 10 * minute)); // soon
      await task(new Date(now.getTime() - 5 * minute)); // just overdue
      await task(new Date(now.getTime() + DUE_SOON_MS + 10 * minute)); // too far, even next tick
      await task(new Date(now.getTime() - 3 * 60 * minute)); // expired long ago
      await task(new Date(now.getTime() + 5 * minute), { status: 'done' });

      const scanner = new TaskDueScanner(dataSource.getRepository(Task), pipeline.dispatcher, logger);
      await scanner.scan(now);
      await scanner.scan(new Date(now.getTime() + 5 * minute)); // next tick: no repeats

      const stored = await rows();
      expect(stored.map((row) => [row.title, row.severity])).toEqual([
        ['Tarea por vencer', 'warning'],
        ['Tarea vencida', 'critical'],
      ]);
      expect(stored[0].body).toMatch(/vence en 10 min$/);
    });
  });

  describe('channel_down / ia_down', () => {
    const channelEvent = (status: 'error' | 'active', previousStatus: 'pending' | 'active' | 'error') =>
      new ChannelStatusChangedEvent(
        company.id,
        {
          channelId: 'ch-1',
          type: 'whatsapp',
          name: 'WhatsApp Ventas',
          status,
          statusReason: status === 'error' ? 'Token vencido' : null,
          at: new Date(),
        },
        previousStatus,
      );

    it('tells admins when a channel goes down (once) and when it recovers, not on first setup', async () => {
      const handler = new ChannelDownNoticeHandler(pipeline.dispatcher, logger);

      await handler.handle(channelEvent('active', 'pending'));
      await handler.handle(channelEvent('error', 'active'));
      await handler.handle(channelEvent('error', 'active'));
      await handler.handle(channelEvent('active', 'error'));

      const stored = await rows();
      expect(stored.map((row) => [row.recipientMemberId, row.severity, row.title, row.body])).toEqual([
        [admin.id, 'critical', 'WhatsApp Ventas dejó de funcionar', 'Token vencido'],
        [admin.id, 'success', 'WhatsApp Ventas volvió a funcionar', expect.any(String)],
      ]);
    });

    it('tells the admins of every company when the IA breaker opens, not when switched off', async () => {
      const other = await seed.company();
      const otherAdmin = await seed.member(other, 'admin');
      const handler = new IaDownNoticeHandler(pipeline.dispatcher, dataSource, logger);

      await handler.handle(
        new IaStatusChangedEvent({ status: 'disabled', enabled: false, available: false, breaker: 'closed' }),
      );
      await handler.handle(
        new IaStatusChangedEvent({ status: 'unavailable', enabled: true, available: false, breaker: 'open' }),
      );
      await handler.handle(
        new IaStatusChangedEvent({ status: 'unavailable', enabled: true, available: false, breaker: 'open' }),
      );

      const stored = await rows();
      expect(stored.map((row) => row.recipientMemberId).sort()).toEqual([admin.id, otherAdmin.id].sort());
      expect(stored.every((row) => row.type === 'ia_down')).toBe(true);
    });
  });
});
