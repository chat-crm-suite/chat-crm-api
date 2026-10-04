import { ForbiddenException } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, DataSourceOptions, IsNull } from 'typeorm';

import {
  Analysis,
  Chat,
  Company,
  Contact,
  Message,
  Notification,
  SentimentAnalysis,
  User,
  WhatsAppConfig,
} from '../src/entities/index';
import { WhatsAppMessageDetail } from '../src/integrations/whatsapp/entities/whatsapp-message-detail.entity';
import {
  ASSIGNED_NOTIFICATION_TITLE,
  ChatAssignmentNotifier,
  UNASSIGNED_NOTIFICATION_TITLE,
} from '../src/modules/chats/assignment/chat-assignment.notifier';
import { ChatAssignmentService } from '../src/modules/chats/assignment/chat-assignment.service';
import { AssignmentOutcome } from '../src/modules/chats/assignment/assignment.types';
import { ChatRepository } from '../src/modules/chats/chat.repository';
import { ChatsService } from '../src/modules/chats/chats.service';
import { ChatGatewayEvent, ChatStatus, ReasonAssignment } from '../src/modules/chats/chat.enum';
import { ChatAssignments, Transfer } from '../src/modules/chats/entities/index';
import type { ChatGateway } from '../src/modules/chats/gateways/chat.gateway';
import { Member } from '../src/modules/member/member.entity';
import { MemberRole, MemberStatus } from '../src/modules/member/member.types';
import {
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from '../src/modules/message/message.enum';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { getTestSQLiteConfig } from './helpers/test-database.helper';

const entities = [
  Analysis,
  Chat,
  ChatAssignments,
  Company,
  Contact,
  Member,
  Message,
  Notification,
  SentimentAnalysis,
  Transfer,
  User,
  WhatsAppConfig,
  WhatsAppMessageDetail,
];

const logger = {
  setContext: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} as unknown as PinoLogger;

describe('ChatAssignmentService (e2e)', () => {
  let dataSource: DataSource;
  let service: ChatAssignmentService;
  let chatsService: ChatsService;
  let notifier: ChatAssignmentNotifier;
  let events: Array<{ room: string; event: ChatGatewayEvent; payload: unknown }>;
  let seq = 0;

  beforeAll(async () => {
    dataSource = new DataSource(getTestSQLiteConfig(entities) as DataSourceOptions);
    await dataSource.initialize();
    service = new ChatAssignmentService(dataSource, logger);

    const cls = { get: jest.fn(() => undefined) } as unknown as ClsService;
    const gateway = {
      server: {
        to: (room: string) => ({
          emit: (event: ChatGatewayEvent, payload: unknown) => {
            events.push({ room, event, payload });
          },
        }),
      },
    } as unknown as ChatGateway;

    const notifications = new NotificationsService(
      dataSource.getRepository(Notification),
      cls,
    );
    notifier = new ChatAssignmentNotifier(notifications, gateway, dataSource, logger);
    chatsService = new ChatsService(
      dataSource.getRepository(Chat),
      dataSource,
      new ChatRepository(dataSource),
      service,
      notifier,
      logger,
      cls,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.synchronize(true);
    events = [];
    seq = 0;
  });

  const seedCompany = (overrides: Partial<Company> = {}) =>
    dataSource.getRepository(Company).save(
      dataSource.getRepository(Company).create({
        name: `company-${++seq}`,
        autoAssignEnabled: true,
        autoAssignMaxChats: 10,
        autoAssignSticky: true,
        autoAssignNotifySupervisors: true,
        ...overrides,
      }),
    );

  const seedMember = async (
    company: Company,
    role: MemberRole = MemberRole.AGENT,
    status: MemberStatus = MemberStatus.ACTIVE,
  ) => {
    const users = dataSource.getRepository(User);
    const user = await users.save(
      users.create({ username: `user-${++seq}`, password: 'secret' }),
    );
    const members = dataSource.getRepository(Member);
    const member = await members.save(
      members.create({ user, company, role, status }),
    );
    return { user, member };
  };

  const seedChat = async (company?: Company) => {
    const contacts = dataSource.getRepository(Contact);
    const contact = await contacts.save(
      contacts.create({
        phoneNumber: `+54911${String(++seq).padStart(8, '0')}`,
        company,
      }),
    );
    const chats = dataSource.getRepository(Chat);
    return chats.save(chats.create({ client: contact }));
  };

  const assign = (chat: Chat, user: User, extra: Partial<ChatAssignments> = {}) => {
    const repo = dataSource.getRepository(ChatAssignments);
    return repo.save(repo.create({ chat, agent: user, reason: ReasonAssignment.AUTO, ...extra }));
  };

  const activeAssignment = (chatId: string) =>
    dataSource.getRepository(ChatAssignments).findOne({
      where: { chat: { id: chatId }, unassignedAt: IsNull() },
      relations: ['agent'],
    });

  const addLastMessage = async (
    chat: Chat,
    senderType: MessageSenderType,
    at: Date,
  ) => {
    const messages = dataSource.getRepository(Message);
    const message = await messages.save(
      messages.create({
        chat: { id: chat.id },
        senderId: senderType === MessageSenderType.CLIENT ? 'client' : 'agent',
        senderType,
        content: 'seed',
        direction:
          senderType === MessageSenderType.CLIENT
            ? MessageDirection.IN
            : MessageDirection.OUT,
        status: MessageStatus.SENT,
        type: MessageType.TEXT,
      }),
    );
    await dataSource
      .getRepository(Chat)
      .update({ id: chat.id }, { lastMessage: { id: message.id }, lastMessageAt: at });
    return message;
  };

  it('assigns the least-loaded active member of the company', async () => {
    const company = await seedCompany();
    const busy = await seedMember(company);
    const free = await seedMember(company);

    await assign(await seedChat(company), busy.user);

    const target = await seedChat(company);
    const outcome = await service.ensureAssigned(target.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.ASSIGNED);
    const active = await activeAssignment(target.id);
    expect(active?.agent.id).toBe(free.user.id);
  });

  it('never assigns members of another company', async () => {
    const company = await seedCompany();
    const other = await seedCompany();
    await seedMember(other);

    const target = await seedChat(company);
    const outcome = await service.ensureAssigned(target.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.NO_CANDIDATES);
    expect(await activeAssignment(target.id)).toBeNull();
  });

  it('stays unassigned when every agent is at the cap', async () => {
    const company = await seedCompany({ autoAssignMaxChats: 1 });
    const agent = await seedMember(company);
    await assign(await seedChat(company), agent.user);

    const target = await seedChat(company);
    const outcome = await service.ensureAssigned(target.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.NO_CANDIDATES);
    expect(await activeAssignment(target.id)).toBeNull();
  });

  it('respects the per-company kill switch', async () => {
    const company = await seedCompany({ autoAssignEnabled: false });
    await seedMember(company);

    const target = await seedChat(company);
    const outcome = await service.ensureAssigned(target.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.DISABLED);
    expect(await activeAssignment(target.id)).toBeNull();
  });

  it('does not reassign a chat that already has an owner', async () => {
    const company = await seedCompany();
    const owner = await seedMember(company);
    await seedMember(company);

    const chat = await seedChat(company);
    await assign(chat, owner.user);

    const outcome = await service.ensureAssigned(chat.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.ALREADY_ASSIGNED);
    const rows = await dataSource
      .getRepository(ChatAssignments)
      .find({ where: { chat: { id: chat.id } } });
    expect(rows).toHaveLength(1);
  });

  it('prefers the previous agent (sticky) even with higher load', async () => {
    const company = await seedCompany();
    const previous = await seedMember(company);
    const free = await seedMember(company);

    await assign(await seedChat(company), previous.user);

    const chat = await seedChat(company);
    await assign(chat, previous.user, {
      unassignedAt: new Date('2026-09-01T00:00:00Z'),
    });

    const outcome = await service.ensureAssigned(chat.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.ASSIGNED);
    const active = await activeAssignment(chat.id);
    expect(active?.agent.id).toBe(previous.user.id);
    expect(active?.agent.id).not.toBe(free.user.id);
  });

  it('re-assigning the same agent updates the historical row (unique pair)', async () => {
    const company = await seedCompany();
    const previous = await seedMember(company);

    const chat = await seedChat(company);
    await assign(chat, previous.user, {
      unassignedAt: new Date('2026-08-01T00:00:00Z'),
    });

    const outcome = await service.ensureAssigned(chat.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.ASSIGNED);
    const rows = await dataSource
      .getRepository(ChatAssignments)
      .find({ where: { chat: { id: chat.id } }, relations: ['agent'] });
    expect(rows).toHaveLength(1);
    expect(rows[0].unassignedAt).toBeNull();
    expect(rows[0].agent.id).toBe(previous.user.id);
  });

  it('claim assigns a free chat, conflicts with another owner and is idempotent', async () => {
    const company = await seedCompany();
    const first = await seedMember(company);
    const second = await seedMember(company);
    const chat = await seedChat(company);

    expect(await service.claim(chat.id, first.user.id, company.id)).toBe(
      AssignmentOutcome.ASSIGNED,
    );
    expect(await service.claim(chat.id, second.user.id, company.id)).toBe(
      AssignmentOutcome.CONFLICT,
    );
    expect(await service.claim(chat.id, first.user.id, company.id)).toBe(
      AssignmentOutcome.ALREADY_ASSIGNED,
    );
  });

  it('claim is skipped for an agent from another company', async () => {
    const company = await seedCompany();
    const other = await seedCompany();
    const outsider = await seedMember(other);
    const chat = await seedChat(company);

    expect(await service.claim(chat.id, outsider.user.id, company.id)).toBe(
      AssignmentOutcome.SKIPPED,
    );
    expect(await activeAssignment(chat.id)).toBeNull();
  });

  it('reassignment requires a supervisor requester', async () => {
    const company = await seedCompany();
    const owner = await seedMember(company);
    const target = await seedMember(company);
    const peer = await seedMember(company);
    const admin = await seedMember(company, MemberRole.ADMIN);

    const chat = await seedChat(company);
    await assign(chat, owner.user);

    await expect(
      service.assignToAgent(chat.id, target.user.id, {
        companyId: company.id,
        requesterId: peer.user.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      await service.assignToAgent(chat.id, target.user.id, {
        companyId: company.id,
        requesterId: admin.user.id,
      }),
    ).toBe(AssignmentOutcome.ASSIGNED);

    const active = await activeAssignment(chat.id);
    expect(active?.agent.id).toBe(target.user.id);

    const previous = await dataSource.getRepository(ChatAssignments).findOne({
      where: { chat: { id: chat.id }, agent: { id: owner.user.id } },
    });
    expect(previous?.unassignedAt).toBeInstanceOf(Date);
  });

  it('skips when the company cannot be resolved and none is provided', async () => {
    const chat = await seedChat();

    expect(await service.ensureAssigned(chat.id)).toBe(AssignmentOutcome.SKIPPED);
  });

  describe('unassigned queue', () => {
    it('lists only unassigned open chats of the company, oldest first', async () => {
      const company = await seedCompany();
      const agent = await seedMember(company);
      const older = await seedChat(company);
      const newer = await seedChat(company);
      const assignedChat = await seedChat(company);
      const closedChat = await seedChat(company);
      const foreign = await seedChat(await seedCompany());

      await assign(assignedChat, agent.user);
      await dataSource
        .getRepository(Chat)
        .update({ id: closedChat.id }, { status: ChatStatus.CLOSED });
      await dataSource
        .getRepository(Chat)
        .update({ id: older.id }, { lastMessageAt: new Date('2026-09-01T00:00:00Z') });
      await dataSource
        .getRepository(Chat)
        .update({ id: newer.id }, { lastMessageAt: new Date('2026-09-02T00:00:00Z') });

      const queue = await service.listUnassigned(company.id);

      expect(queue.map((chat) => chat.id)).toEqual([older.id, newer.id]);
      expect(queue.map((chat) => chat.id)).not.toContain(foreign.id);
    });
  });

  describe('notifications (Q12)', () => {
    it('notifies admin/manager once when a chat stays unassigned', async () => {
      const company = await seedCompany();
      const admin = await seedMember(company, MemberRole.ADMIN);
      const manager = await seedMember(company, MemberRole.MANAGER);
      await seedMember(company, MemberRole.AGENT);
      const chat = await seedChat(company);

      await notifier.notifyUnassigned(chat.id, company.id);

      const created = await dataSource
        .getRepository(Notification)
        .find({ relations: ['user'] });
      expect(created).toHaveLength(2);
      expect(created.map((n) => n.user.id).sort()).toEqual(
        [admin.user.id, manager.user.id].sort(),
      );
      expect(
        events.filter((e) => e.event === ChatGatewayEvent.NewNotification),
      ).toHaveLength(2);

      // Segundo chat sin asignar: dedupe por notificación no leída.
      await notifier.notifyUnassigned((await seedChat(company)).id, company.id);
      expect(await dataSource.getRepository(Notification).count()).toBe(2);

      expect(
        events.some(
          (e) =>
            e.room === `company:${company.id}` &&
            e.event === ChatGatewayEvent.ChatUnassigned,
        ),
      ).toBe(true);
    });

    it('resolves the company from the chat when none is passed', async () => {
      const company = await seedCompany();
      await seedMember(company, MemberRole.ADMIN);
      const chat = await seedChat(company);

      await notifier.notifyUnassigned(chat.id);

      expect(await dataSource.getRepository(Notification).count()).toBe(1);
    });

    it('respects the notify-supervisors switch', async () => {
      const company = await seedCompany({ autoAssignNotifySupervisors: false });
      await seedMember(company, MemberRole.ADMIN);
      const chat = await seedChat(company);

      await notifier.notifyUnassigned(chat.id, company.id);

      expect(await dataSource.getRepository(Notification).count()).toBe(0);
    });

    it('notifies the assigned agent and emits chat:assigned', async () => {
      const company = await seedCompany();
      const agent = await seedMember(company);
      const chat = await seedChat(company);

      await notifier.notifyAssigned(chat.id, agent.user.id);

      const created = await dataSource
        .getRepository(Notification)
        .find({ relations: ['user'] });
      expect(created).toHaveLength(1);
      expect(created[0].title).toBe(ASSIGNED_NOTIFICATION_TITLE);
      expect(created[0].user.id).toBe(agent.user.id);
      expect(
        events.some(
          (e) =>
            e.room === `user:${agent.user.id}` &&
            e.event === ChatGatewayEvent.ChatAssigned,
        ),
      ).toBe(true);
    });

    it('does not persist a notification when the agent claims their own chat', async () => {
      const company = await seedCompany();
      const agent = await seedMember(company);
      const chat = await seedChat(company);

      await notifier.notifyAssigned(chat.id, agent.user.id, false);

      expect(await dataSource.getRepository(Notification).count()).toBe(0);
      expect(events.some((e) => e.event === ChatGatewayEvent.ChatAssigned)).toBe(true);
    });
  });

  describe('ChatsService orchestration', () => {
    it('auto-assigns and notifies the chosen agent end to end', async () => {
      const company = await seedCompany();
      const agent = await seedMember(company);
      const chat = await seedChat(company);

      const outcome = await chatsService.ensureAssigned(chat.id, company.id);

      expect(outcome).toBe(AssignmentOutcome.ASSIGNED);
      const created = await dataSource
        .getRepository(Notification)
        .find({ relations: ['user'] });
      expect(created).toHaveLength(1);
      expect(created[0].user.id).toBe(agent.user.id);
      expect(created[0].title).toBe(ASSIGNED_NOTIFICATION_TITLE);
    });

    it('notifies supervisors when nobody is available', async () => {
      const company = await seedCompany({ autoAssignMaxChats: 1 });
      const supervisor = await seedMember(company, MemberRole.ADMIN);
      await assign(await seedChat(company), supervisor.user);

      const chat = await seedChat(company);
      const outcome = await chatsService.ensureAssigned(chat.id, company.id);

      expect(outcome).toBe(AssignmentOutcome.NO_CANDIDATES);
      const created = await dataSource
        .getRepository(Notification)
        .find({ relations: ['user'] });
      expect(created).toHaveLength(1);
      expect(created[0].user.id).toBe(supervisor.user.id);
      expect(created[0].title).toBe(UNASSIGNED_NOTIFICATION_TITLE);
    });

    it('claim orchestrates assignment and event without self-notification', async () => {
      const company = await seedCompany();
      const agent = await seedMember(company);
      const chat = await seedChat(company);

      const outcome = await chatsService.claim(chat.id, agent.user.id, company.id);

      expect(outcome).toBe(AssignmentOutcome.ASSIGNED);
      expect(await dataSource.getRepository(Notification).count()).toBe(0);
      expect(events.some((e) => e.event === ChatGatewayEvent.ChatAssigned)).toBe(true);
    });
  });

  describe('needs-response view (Q10)', () => {
    it('lists client messages waiting for a reply with their current owner', async () => {
      const company = await seedCompany();
      const agent = await seedMember(company);
      const waiting = await seedChat(company);
      const pending = await seedChat(company);
      const answered = await seedChat(company);
      const recent = await seedChat(company);
      const foreign = await seedChat(await seedCompany());

      await addLastMessage(
        waiting,
        MessageSenderType.CLIENT,
        new Date('2026-10-01T10:00:00Z'),
      );
      await addLastMessage(
        pending,
        MessageSenderType.CLIENT,
        new Date('2026-10-01T11:00:00Z'),
      );
      await addLastMessage(
        answered,
        MessageSenderType.AGENT,
        new Date('2026-10-01T09:00:00Z'),
      );
      await addLastMessage(recent, MessageSenderType.CLIENT, new Date());
      await addLastMessage(
        foreign,
        MessageSenderType.CLIENT,
        new Date('2026-10-01T08:00:00Z'),
      );

      await assign(waiting, agent.user);

      const result = await service.listNeedsResponse(company.id, 15);

      expect(result.map((chat) => chat.id)).toEqual([waiting.id, pending.id]);
      expect(result[0].agent?.id).toBe(agent.user.id);
      expect(result[1].agent).toBeNull();
    });
  });
});
