// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ForbiddenException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, DataSourceOptions, EntityTarget, IsNull } from 'typeorm';

import type { MemberRole, MemberStatus } from '../src/contracts/index';
import { ConversationSocketEvent } from '../src/contracts/index';
import * as Entities from '../src/entities/index';
import { Channel } from '../src/modules/channels/entities/channel.entity';
import { CompanyMember } from '../src/modules/company-members/entities/company-member.entity';
import { CompanySettings } from '../src/modules/company/entities/company-settings.entity';
import { Company } from '../src/modules/company/entities/company.entity';
import { AssignmentOutcome } from '../src/modules/conversations/assignment/assignment.types';
import {
  ASSIGNED_NOTIFICATION_TITLE,
  ConversationAssignmentNotifier,
  UNASSIGNED_NOTIFICATION_TITLE,
} from '../src/modules/conversations/assignment/conversation-assignment.notifier';
import { ConversationAssignmentService } from '../src/modules/conversations/assignment/conversation-assignment.service';
import { ConversationRepository } from '../src/modules/conversations/conversation.repository';
import { ConversationsService } from '../src/modules/conversations/conversations.service';
import { ConversationAssignment } from '../src/modules/conversations/entities/conversation-assignment.entity';
import { Conversation } from '../src/modules/conversations/entities/conversation.entity';
import type { ConversationGateway } from '../src/modules/conversations/gateways/conversation.gateway';
import { Customer } from '../src/modules/customers/entities/customer.entity';
import type { MessageService } from '../src/modules/message/message.service';
import { Message } from '../src/modules/message/entities/message.entity';
import { Notification } from '../src/modules/notifications/entities/notification.entity';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { User } from '../src/modules/users/entities/user.entity';
import { getTestConfig, truncateAllTables } from './helpers/test-database.helper';

const entities = Object.values(Entities) as EntityTarget<unknown>[];

jest.setTimeout(180_000);

const logger = {
  setContext: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} as unknown as PinoLogger;

describe('ConversationAssignmentService (e2e)', () => {
  let dataSource: DataSource;
  let service: ConversationAssignmentService;
  let conversationsService: ConversationsService;
  let notifier: ConversationAssignmentNotifier;
  let events: Array<{ room: string; event: string; payload: unknown }>;
  let seq = 0;

  beforeAll(async () => {
    dataSource = new DataSource(getTestConfig(entities) as DataSourceOptions);
    await dataSource.initialize();
    service = new ConversationAssignmentService(dataSource, logger);

    const gateway = {
      server: {
        to: (room: string) => ({
          emit: (event: string, payload: unknown) => {
            events.push({ room, event, payload });
          },
        }),
      },
    } as unknown as ConversationGateway;

    const notifications = new NotificationsService(
      dataSource.getRepository(Notification),
      dataSource.getRepository(CompanyMember),
    );
    notifier = new ConversationAssignmentNotifier(
      notifications,
      gateway,
      dataSource,
      logger,
    );
    conversationsService = new ConversationsService(
      dataSource.getRepository(Conversation),
      dataSource.getRepository(ConversationAssignment),
      dataSource.getRepository(CompanyMember),
      service,
      notifier,
      {} as unknown as ConversationRepository,
      {} as unknown as MessageService,
      logger,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    events = [];
    seq = 0;
  });

  const seedCompany = async (
    settingsOverrides: Partial<CompanySettings> = {},
  ): Promise<{ company: Company; settings: CompanySettings }> => {
    const companies = dataSource.getRepository(Company);
    const company = await companies.save(
      companies.create({ name: `company-${++seq}` }),
    );

    const settingsRepo = dataSource.getRepository(CompanySettings);
    const settings = await settingsRepo.save(
      settingsRepo.create({
        companyId: company.id,
        autoAssignEnabled: true,
        autoAssignMaxOpen: 10,
        autoAssignSticky: true,
        autoAssignNotifySupervisors: true,
        ...settingsOverrides,
      }),
    );

    return { company, settings };
  };

  const seedMember = async (
    company: Company,
    role: MemberRole = 'agent',
    status: MemberStatus = 'active',
  ) => {
    const users = dataSource.getRepository(User);
    const user = await users.save(
      users.create({
        username: `user-${++seq}`,
        passwordHash: '$2b$04$le0E9pls3D0fXBhXbv3aS.ejZsbJdrtuJIxiO0ov95jwoBVgaknaS',
      }),
    );
    const members = dataSource.getRepository(CompanyMember);
    const member = await members.save(
      members.create({
        userId: user.id,
        companyId: company.id,
        role,
        status,
      }),
    );
    return { user, member };
  };

  const seedConversation = async (company: Company) => {
    const customers = dataSource.getRepository(Customer);
    const customer = await customers.save(
      customers.create({
        companyId: company.id,
        displayName: `Customer ${++seq}`,
        phoneNumber: `+54911${String(++seq).padStart(8, '0')}`,
      }),
    );

    const channels = dataSource.getRepository(Channel);
    const channel = await channels.save(
      channels.create({
        companyId: company.id,
        type: 'whatsapp',
        name: `channel-${++seq}`,
        externalAccountId: `wa-account-${++seq}`,
        credentials: 'test-credentials',
      }),
    );

    const conversations = dataSource.getRepository(Conversation);
    return conversations.save(
      conversations.create({
        companyId: company.id,
        customerId: customer.id,
        channelId: channel.id,
      }),
    );
  };

  const assign = (
    conversation: Conversation,
    member: CompanyMember,
    extra: Partial<ConversationAssignment> = {},
  ) => {
    const repo = dataSource.getRepository(ConversationAssignment);
    return repo.save(
      repo.create({
        conversationId: conversation.id,
        memberId: member.id,
        reason: 'auto',
        assignedAt: new Date(),
        ...extra,
      }),
    );
  };

  const activeAssignment = (conversationId: string) =>
    dataSource.getRepository(ConversationAssignment).findOne({
      where: { conversationId, unassignedAt: IsNull() },
      relations: { member: { user: true } },
    });

  const addLastMessage = async (
    conversation: Conversation,
    direction: 'inbound' | 'outbound',
    at: Date,
    member?: CompanyMember,
  ) => {
    const messages = dataSource.getRepository(Message);
    const message = await messages.save(
      messages.create({
        companyId: conversation.companyId,
        conversationId: conversation.id,
        direction,
        senderType: direction === 'inbound' ? 'customer' : 'member',
        senderCustomerId:
          direction === 'inbound' ? conversation.customerId : null,
        senderMemberId: direction === 'outbound' ? (member?.id ?? null) : null,
        body: 'seed',
        status: direction === 'inbound' ? 'delivered' : 'sent',
        type: 'text',
      }),
    );

    await dataSource.getRepository(Conversation).update(
      { id: conversation.id },
      {
        lastMessageId: message.id,
        lastMessageAt: at,
        ...(direction === 'inbound'
          ? { lastInboundAt: at }
          : { lastOutboundAt: at }),
      },
    );

    return message;
  };

  it('assigns the least-loaded active member of the company', async () => {
    const { company } = await seedCompany();
    const busy = await seedMember(company);
    const free = await seedMember(company);

    await assign(await seedConversation(company), busy.member);

    const target = await seedConversation(company);
    const outcome = await service.ensureAssigned(target.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.ASSIGNED);
    const active = await activeAssignment(target.id);
    expect(active?.memberId).toBe(free.member.id);
  });

  it('never assigns members of another company', async () => {
    const { company } = await seedCompany();
    const { company: other } = await seedCompany();
    await seedMember(other);

    const target = await seedConversation(company);
    const outcome = await service.ensureAssigned(target.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.NO_CANDIDATES);
    expect(await activeAssignment(target.id)).toBeNull();
  });

  it('stays unassigned when every agent is at the cap', async () => {
    const { company } = await seedCompany({ autoAssignMaxOpen: 1 });
    const agent = await seedMember(company);
    await assign(await seedConversation(company), agent.member);

    const target = await seedConversation(company);
    const outcome = await service.ensureAssigned(target.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.NO_CANDIDATES);
    expect(await activeAssignment(target.id)).toBeNull();
  });

  it('respects the per-company kill switch', async () => {
    const { company } = await seedCompany({ autoAssignEnabled: false });
    await seedMember(company);

    const target = await seedConversation(company);
    const outcome = await service.ensureAssigned(target.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.DISABLED);
    expect(await activeAssignment(target.id)).toBeNull();
  });

  it('does not reassign a conversation that already has an owner', async () => {
    const { company } = await seedCompany();
    const owner = await seedMember(company);
    await seedMember(company);

    const conversation = await seedConversation(company);
    await assign(conversation, owner.member);

    const outcome = await service.ensureAssigned(conversation.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.ALREADY_ASSIGNED);
    const rows = await dataSource
      .getRepository(ConversationAssignment)
      .find({ where: { conversationId: conversation.id } });
    expect(rows).toHaveLength(1);
  });

  it('prefers the previous agent (sticky) even with higher load', async () => {
    const { company } = await seedCompany();
    const previous = await seedMember(company);
    const free = await seedMember(company);

    await assign(await seedConversation(company), previous.member);

    const conversation = await seedConversation(company);
    await assign(conversation, previous.member, {
      unassignedAt: new Date('2026-09-01T00:00:00Z'),
    });

    const outcome = await service.ensureAssigned(conversation.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.ASSIGNED);
    const active = await activeAssignment(conversation.id);
    expect(active?.memberId).toBe(previous.member.id);
    expect(active?.memberId).not.toBe(free.member.id);
  });

  it('re-assigning the same agent inserts a new historical row (no unique pair)', async () => {
    const { company } = await seedCompany();
    const previous = await seedMember(company);

    const conversation = await seedConversation(company);
    await assign(conversation, previous.member, {
      unassignedAt: new Date('2026-08-01T00:00:00Z'),
    });

    const outcome = await service.ensureAssigned(conversation.id, company.id);

    expect(outcome).toBe(AssignmentOutcome.ASSIGNED);
    const rows = await dataSource
      .getRepository(ConversationAssignment)
      .find({ where: { conversationId: conversation.id } });
    expect(rows).toHaveLength(2);
    const active = rows.find((row) => row.unassignedAt === null);
    expect(active?.memberId).toBe(previous.member.id);
  });

  it('claim assigns a free conversation, conflicts with another owner and is idempotent', async () => {
    const { company } = await seedCompany();
    const first = await seedMember(company);
    const second = await seedMember(company);
    const conversation = await seedConversation(company);

    expect(
      await service.claimForUser(conversation.id, first.user.id, company.id),
    ).toBe(AssignmentOutcome.ASSIGNED);
    expect(
      await service.claimForUser(conversation.id, second.user.id, company.id),
    ).toBe(AssignmentOutcome.CONFLICT);
    expect(
      await service.claimForUser(conversation.id, first.user.id, company.id),
    ).toBe(AssignmentOutcome.ALREADY_ASSIGNED);
  });

  it('claim is skipped for an agent from another company', async () => {
    const { company } = await seedCompany();
    const { company: other } = await seedCompany();
    const outsider = await seedMember(other);
    const conversation = await seedConversation(company);

    expect(
      await service.claimForUser(conversation.id, outsider.user.id, company.id),
    ).toBe(AssignmentOutcome.SKIPPED);
    expect(await activeAssignment(conversation.id)).toBeNull();
  });

  it('reassignment requires a supervisor requester', async () => {
    const { company } = await seedCompany();
    const owner = await seedMember(company);
    const target = await seedMember(company);
    const peer = await seedMember(company);
    const admin = await seedMember(company, 'admin');

    const conversation = await seedConversation(company);
    await assign(conversation, owner.member);

    await expect(
      service.assignToAgent(conversation.id, target.member.id, {
        companyId: company.id,
        requesterId: peer.user.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      await service.assignToAgent(conversation.id, target.member.id, {
        companyId: company.id,
        requesterId: admin.user.id,
      }),
    ).toBe(AssignmentOutcome.ASSIGNED);

    const active = await activeAssignment(conversation.id);
    expect(active?.memberId).toBe(target.member.id);

    const previous = await dataSource
      .getRepository(ConversationAssignment)
      .findOne({
        where: {
          conversationId: conversation.id,
          memberId: owner.member.id,
        },
      });
    expect(previous?.unassignedAt).toBeInstanceOf(Date);
  });

  it('skips when the conversation does not exist', async () => {
    expect(await service.ensureAssigned('missing-conversation')).toBe(
      AssignmentOutcome.SKIPPED,
    );
  });

  it('skips when the company has no settings row', async () => {
    const companies = dataSource.getRepository(Company);
    const company = await companies.save(
      companies.create({ name: `company-${++seq}` }),
    );
    const conversation = await seedConversation(company);

    expect(await service.ensureAssigned(conversation.id, company.id)).toBe(
      AssignmentOutcome.SKIPPED,
    );
  });

  describe('unassigned queue', () => {
    it('lists only unassigned open conversations of the company, oldest first', async () => {
      const { company } = await seedCompany();
      const agent = await seedMember(company);
      const older = await seedConversation(company);
      const newer = await seedConversation(company);
      const assignedConversation = await seedConversation(company);
      const closedConversation = await seedConversation(company);
      const { company: foreignCompany } = await seedCompany();
      const foreign = await seedConversation(foreignCompany);

      await assign(assignedConversation, agent.member);
      await dataSource
        .getRepository(Conversation)
        .update({ id: closedConversation.id }, { status: 'closed' });
      await dataSource
        .getRepository(Conversation)
        .update(
          { id: older.id },
          { lastMessageAt: new Date('2026-09-01T00:00:00Z') },
        );
      await dataSource
        .getRepository(Conversation)
        .update(
          { id: newer.id },
          { lastMessageAt: new Date('2026-09-02T00:00:00Z') },
        );

      const queue = await service.listUnassigned(company.id);

      expect(queue.map((row) => row.id)).toEqual([older.id, newer.id]);
      expect(queue.map((row) => row.id)).not.toContain(foreign.id);
      expect(queue[0].customer.displayName).toBeDefined();
    });
  });

  describe('notifications (Q12)', () => {
    it('notifies admin/supervisor once when a conversation stays unassigned', async () => {
      const { company } = await seedCompany();
      const admin = await seedMember(company, 'admin');
      const supervisor = await seedMember(company, 'supervisor');
      await seedMember(company, 'agent');
      const conversation = await seedConversation(company);

      await notifier.notifyUnassigned(conversation.id, company.id);

      const created = await dataSource
        .getRepository(Notification)
        .find({ relations: { recipientMember: true } });
      expect(created).toHaveLength(2);
      expect(created.map((n) => n.recipientMemberId).sort()).toEqual(
        [admin.member.id, supervisor.member.id].sort(),
      );
      expect(
        events.filter((e) => e.event === ConversationSocketEvent.NewNotification),
      ).toHaveLength(2);

      // Segundo chat sin asignar: dedupe por notificación no leída.
      await notifier.notifyUnassigned(
        (await seedConversation(company)).id,
        company.id,
      );
      expect(await dataSource.getRepository(Notification).count()).toBe(2);

      expect(
        events.some(
          (e) =>
            e.room === `company:${company.id}` &&
            e.event === ConversationSocketEvent.ConversationUnassigned,
        ),
      ).toBe(true);
    });

    it('resolves the company from the conversation when none is passed', async () => {
      const { company } = await seedCompany();
      await seedMember(company, 'admin');
      const conversation = await seedConversation(company);

      await notifier.notifyUnassigned(conversation.id);

      expect(await dataSource.getRepository(Notification).count()).toBe(1);
    });

    it('respects the notify-supervisors switch', async () => {
      const { company } = await seedCompany({
        autoAssignNotifySupervisors: false,
      });
      await seedMember(company, 'admin');
      const conversation = await seedConversation(company);

      await notifier.notifyUnassigned(conversation.id, company.id);

      expect(await dataSource.getRepository(Notification).count()).toBe(0);
    });

    it('notifies the assigned agent and emits conversation:assigned', async () => {
      const { company } = await seedCompany();
      const agent = await seedMember(company);
      const conversation = await seedConversation(company);

      await notifier.notifyAssigned(conversation.id, agent.member.id);

      const created = await dataSource
        .getRepository(Notification)
        .find({ relations: { recipientMember: true } });
      expect(created).toHaveLength(1);
      expect(created[0].title).toBe(ASSIGNED_NOTIFICATION_TITLE);
      expect(created[0].recipientMemberId).toBe(agent.member.id);
      expect(
        events.some(
          (e) =>
            e.room === `user:${agent.user.id}` &&
            e.event === ConversationSocketEvent.ConversationAssigned,
        ),
      ).toBe(true);
    });

    it('does not persist a notification when the agent claims their own conversation', async () => {
      const { company } = await seedCompany();
      const agent = await seedMember(company);
      const conversation = await seedConversation(company);

      await notifier.notifyAssigned(conversation.id, agent.member.id, false);

      expect(await dataSource.getRepository(Notification).count()).toBe(0);
      expect(
        events.some(
          (e) => e.event === ConversationSocketEvent.ConversationAssigned,
        ),
      ).toBe(true);
    });
  });

  describe('ConversationsService orchestration', () => {
    it('auto-assigns and notifies the chosen agent end to end', async () => {
      const { company } = await seedCompany();
      const agent = await seedMember(company);
      const conversation = await seedConversation(company);

      const outcome = await conversationsService.ensureAssigned(
        conversation.id,
        company.id,
      );

      expect(outcome).toBe(AssignmentOutcome.ASSIGNED);
      const created = await dataSource
        .getRepository(Notification)
        .find({ relations: { recipientMember: true } });
      expect(created).toHaveLength(1);
      expect(created[0].recipientMemberId).toBe(agent.member.id);
      expect(created[0].title).toBe(ASSIGNED_NOTIFICATION_TITLE);
    });

    it('notifies supervisors when nobody is available', async () => {
      const { company } = await seedCompany({ autoAssignMaxOpen: 1 });
      const supervisor = await seedMember(company, 'admin');
      await assign(await seedConversation(company), supervisor.member);

      const conversation = await seedConversation(company);
      const outcome = await conversationsService.ensureAssigned(
        conversation.id,
        company.id,
      );

      expect(outcome).toBe(AssignmentOutcome.NO_CANDIDATES);
      const created = await dataSource
        .getRepository(Notification)
        .find({ relations: { recipientMember: true } });
      expect(created).toHaveLength(1);
      expect(created[0].recipientMemberId).toBe(supervisor.member.id);
      expect(created[0].title).toBe(UNASSIGNED_NOTIFICATION_TITLE);
    });

    it('claim orchestrates assignment and event without self-notification', async () => {
      const { company } = await seedCompany();
      const agent = await seedMember(company);
      const conversation = await seedConversation(company);

      const outcome = await conversationsService.claim(
        conversation.id,
        agent.user.id,
        company.id,
      );

      expect(outcome).toBe(AssignmentOutcome.ASSIGNED);
      expect(await dataSource.getRepository(Notification).count()).toBe(0);
      expect(
        events.some(
          (e) => e.event === ConversationSocketEvent.ConversationAssigned,
        ),
      ).toBe(true);
    });
  });

  describe('needs-response view (Q10)', () => {
    it('lists client messages waiting for a reply with their current owner', async () => {
      const { company } = await seedCompany();
      const agent = await seedMember(company);
      const waiting = await seedConversation(company);
      const pending = await seedConversation(company);
      const answered = await seedConversation(company);
      const recent = await seedConversation(company);
      const { company: foreignCompany } = await seedCompany();
      const foreign = await seedConversation(foreignCompany);

      await addLastMessage(
        waiting,
        'inbound',
        new Date('2026-10-01T10:00:00Z'),
      );
      await addLastMessage(
        pending,
        'inbound',
        new Date('2026-10-01T11:00:00Z'),
      );
      await addLastMessage(
        answered,
        'outbound',
        new Date('2026-10-01T09:00:00Z'),
        agent.member,
      );
      await addLastMessage(recent, 'inbound', new Date());
      await addLastMessage(
        foreign,
        'inbound',
        new Date('2026-10-01T08:00:00Z'),
      );

      await assign(waiting, agent.member);

      const result = await service.listNeedsResponse(company.id, 15);

      expect(result.map((row) => row.id)).toEqual([waiting.id, pending.id]);
      expect(result[0].member?.id).toBe(agent.member.id);
      expect(result[1].member).toBeNull();
    });
  });
});
