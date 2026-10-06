// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { PinoLogger } from 'nestjs-pino';
import { DataSource, DataSourceOptions, EntityTarget, IsNull } from 'typeorm';

import type { MemberRole } from '../../../contracts/index';
import { ConversationSocketEvent } from '../../../contracts/index';
import * as Entities from '../../../entities/index';
import { Channel } from '../../channels/entities/channel.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { CompanySettings } from '../../company/entities/company-settings.entity';
import { Company } from '../../company/entities/company.entity';
import { Customer } from '../../customers/entities/customer.entity';
import type { MessageService } from '../../message/message.service';
import { Notification } from '../../notifications/entities/notification.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { User } from '../../users/entities/user.entity';
import {
  getTestConfig,
  truncateAllTables,
} from '../../../../test/helpers/test-database.helper';
import { ConversationAssignmentNotifier } from '../assignment/conversation-assignment.notifier';
import { ConversationAssignmentService } from '../assignment/conversation-assignment.service';
import { AssignmentOutcome } from '../assignment/assignment.types';
import { ConversationRepository } from '../conversation.repository';
import { ConversationsService } from '../conversations.service';
import { ConversationAssignment } from '../entities/conversation-assignment.entity';
import { Conversation } from '../entities/conversation.entity';
import type { ConversationGateway } from '../gateways/conversation.gateway';
import { ConversationAccessService } from './conversation-access.service';
import { ConversationFanoutService } from './conversation-fanout.service';

const entities = Object.values(Entities) as EntityTarget<unknown>[];

jest.setTimeout(180_000);

const logger = {
  setContext: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} as unknown as PinoLogger;

/**
 * T6 end-to-end seam over MySQL: the single fanout path resolves the real
 * assignee, and an inbound message that leaves the conversation ownerless
 * reaches the supervisors live.
 */
describe('Realtime fanout (T6)', () => {
  let dataSource: DataSource;
  let access: ConversationAccessService;
  let fanout: ConversationFanoutService;
  let conversationsService: ConversationsService;
  let events: Array<{ room: string; event: string; payload: unknown }>;
  let seq = 0;

  beforeAll(async () => {
    dataSource = new DataSource(getTestConfig(entities) as DataSourceOptions);
    await dataSource.initialize();

    const assignment = new ConversationAssignmentService(dataSource, logger);
    access = new ConversationAccessService(dataSource, assignment, logger);

    const gateway = {
      server: {
        to: (room: string) => ({
          emit: (event: string, payload: unknown) => {
            events.push({ room, event, payload });
          },
        }),
      },
    } as unknown as ConversationGateway;

    fanout = new ConversationFanoutService(gateway, access, logger);

    const notifications = new NotificationsService(
      dataSource.getRepository(Notification),
      dataSource.getRepository(CompanyMember),
    );
    const notifier = new ConversationAssignmentNotifier(
      notifications,
      gateway,
      dataSource,
      logger,
    );

    conversationsService = new ConversationsService(
      dataSource.getRepository(Conversation),
      dataSource.getRepository(ConversationAssignment),
      dataSource.getRepository(CompanyMember),
      assignment,
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
  ): Promise<Company> => {
    const companies = dataSource.getRepository(Company);
    const company = await companies.save(
      companies.create({ name: `company-${++seq}` }),
    );

    const settingsRepo = dataSource.getRepository(CompanySettings);
    await settingsRepo.save(
      settingsRepo.create({
        companyId: company.id,
        autoAssignEnabled: true,
        autoAssignMaxOpen: 10,
        autoAssignSticky: true,
        autoAssignNotifySupervisors: true,
        ...settingsOverrides,
      }),
    );

    return company;
  };

  const seedMember = async (company: Company, role: MemberRole = 'agent') => {
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
        status: 'active',
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

  const assign = async (
    conversation: Conversation,
    member: CompanyMember,
  ) => {
    const repo = dataSource.getRepository(ConversationAssignment);
    await repo.save(
      repo.create({
        conversationId: conversation.id,
        memberId: member.id,
        reason: 'auto',
        assignedAt: new Date(),
      }),
    );
    await dataSource
      .getRepository(Conversation)
      .update({ id: conversation.id }, { assignedMemberId: member.id });
  };

  it('resolves the real assignee and never emits the body to a company room', async () => {
    const company = await seedCompany();
    const agent = await seedMember(company);
    const conversation = await seedConversation(company);
    await assign(conversation, agent.member);

    await fanout.emitMessage(conversation.id, {
      id: 'msg-1',
      conversationId: conversation.id,
      timestamp: new Date(),
      status: 'delivered',
      sender: { id: 'cust-1', type: 'customer' },
      msg: { type: 'text', content: { body: 'hola' } },
    });

    const rooms = events.map((entry) => entry.room);
    expect(rooms).toEqual([
      `conversation:${conversation.id}`,
      `user:${agent.user.id}`,
    ]);
    expect(rooms.some((room) => room.startsWith('company:'))).toBe(false);
  });

  it('notifies supervisors live when an inbound message leaves the conversation unassigned', async () => {
    const company = await seedCompany({ autoAssignEnabled: false });
    const supervisor = await seedMember(company, 'supervisor');
    const conversation = await seedConversation(company);

    const outcome = await conversationsService.ensureAssigned(
      conversation.id,
      company.id,
    );

    expect(outcome).toBe(AssignmentOutcome.DISABLED);
    const active = await dataSource
      .getRepository(ConversationAssignment)
      .findOne({
        where: { conversationId: conversation.id, unassignedAt: IsNull() },
      });
    expect(active).toBeNull();

    expect(
      events.some(
        (entry) =>
          entry.room === `user:${supervisor.user.id}` &&
          entry.event === ConversationSocketEvent.NewNotification,
      ),
    ).toBe(true);
    expect(
      events.some(
        (entry) =>
          entry.room === `company:${company.id}` &&
          entry.event === ConversationSocketEvent.ConversationUnassigned,
      ),
    ).toBe(true);
  });

  it('keeps message content out of the supervisor notice', async () => {
    const company = await seedCompany({ autoAssignEnabled: false });
    const supervisor = await seedMember(company, 'admin');
    const conversation = await seedConversation(company);

    await conversationsService.ensureAssigned(conversation.id, company.id);

    const notice = events.find(
      (entry) =>
        entry.room === `user:${supervisor.user.id}` &&
        entry.event === ConversationSocketEvent.NewNotification,
    );
    expect(notice?.payload).toEqual(
      expect.objectContaining({
        body: 'Hay un chat esperando agente en la cola',
        data: { conversationId: conversation.id },
      }),
    );

    const queue = events.find(
      (entry) => entry.event === ConversationSocketEvent.ConversationUnassigned,
    );
    expect(queue?.payload).toEqual({ conversationId: conversation.id });
  });
});
