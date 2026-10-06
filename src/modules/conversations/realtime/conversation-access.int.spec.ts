import { ForbiddenException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, DataSourceOptions, EntityTarget } from 'typeorm';

import type { MemberRole } from '../../../contracts/index';
import * as Entities from '../../../entities/index';
import { Channel } from '../../channels/entities/channel.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { Company } from '../../company/entities/company.entity';
import { ConversationAssignmentService } from '../assignment/conversation-assignment.service';
import { ConversationAssignment } from '../entities/conversation-assignment.entity';
import { Conversation } from '../entities/conversation.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { User } from '../../users/entities/user.entity';
import {
  getTestConfig,
  truncateAllTables,
} from '../../../../test/helpers/test-database.helper';
import {
  ConversationAccessService,
  type ConversationSocketIdentity,
} from './conversation-access.service';

const entities = Object.values(Entities) as EntityTarget<unknown>[];

jest.setTimeout(180_000);

const logger = {
  setContext: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} as unknown as PinoLogger;

/**
 * T6 membership seam: joining a conversation room is authorized against
 * `company_members` (role) and the conversation's active assignment. Agents
 * only reach their own chats or the unassigned queue; admin/supervisor reach
 * their whole company; nothing crosses a company boundary.
 */
describe('ConversationAccessService (T6)', () => {
  let dataSource: DataSource;
  let access: ConversationAccessService;
  let seq = 0;

  beforeAll(async () => {
    dataSource = new DataSource(getTestConfig(entities) as DataSourceOptions);
    await dataSource.initialize();
    access = new ConversationAccessService(
      dataSource,
      new ConversationAssignmentService(dataSource, logger),
      logger,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    seq = 0;
  });

  const seedCompany = async (): Promise<Company> => {
    const companies = dataSource.getRepository(Company);
    return companies.save(companies.create({ name: `company-${++seq}` }));
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

  const assign = (
    conversation: Conversation,
    member: CompanyMember,
    unassignedAt: Date | null = null,
  ) => {
    const repo = dataSource.getRepository(ConversationAssignment);
    return repo.save(
      repo.create({
        conversationId: conversation.id,
        memberId: member.id,
        reason: 'auto',
        assignedAt: new Date(),
        unassignedAt,
      }),
    );
  };

  const identity = (
    companyId: string,
    userId: string,
  ): ConversationSocketIdentity => ({
    companyId,
    userId,
    authenticated: true,
  });

  it("denies an agent joining another agent's conversation", async () => {
    const company = await seedCompany();
    const owner = await seedMember(company);
    const peer = await seedMember(company);
    const conversation = await seedConversation(company);
    await assign(conversation, owner.member);

    await expect(
      access.assertCanJoinConversation(
        conversation.id,
        identity(company.id, peer.user.id),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an agent join their own conversation and the unassigned queue', async () => {
    const company = await seedCompany();
    const agent = await seedMember(company);
    const own = await seedConversation(company);
    const queued = await seedConversation(company);
    await assign(own, agent.member);

    await expect(
      access.assertCanJoinConversation(own.id, identity(company.id, agent.user.id)),
    ).resolves.toEqual({ room: `conversation:${own.id}` });
    await expect(
      access.assertCanJoinConversation(
        queued.id,
        identity(company.id, agent.user.id),
      ),
    ).resolves.toEqual({ room: `conversation:${queued.id}` });
  });

  it('denies an agent once the conversation is reassigned to a peer', async () => {
    const company = await seedCompany();
    const previous = await seedMember(company);
    const peer = await seedMember(company);
    const conversation = await seedConversation(company);
    await assign(conversation, previous.member, new Date('2026-10-01T00:00:00Z'));
    await assign(conversation, peer.member);

    await expect(
      access.assertCanJoinConversation(
        conversation.id,
        identity(company.id, previous.user.id),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      access.assertCanJoinConversation(
        conversation.id,
        identity(company.id, peer.user.id),
      ),
    ).resolves.toEqual({ room: `conversation:${conversation.id}` });
  });

  it('lets admin and supervisor join every conversation of their company', async () => {
    const company = await seedCompany();
    const owner = await seedMember(company);
    const admin = await seedMember(company, 'admin');
    const supervisor = await seedMember(company, 'supervisor');
    const conversation = await seedConversation(company);
    await assign(conversation, owner.member);

    for (const privileged of [admin, supervisor]) {
      await expect(
        access.assertCanJoinConversation(
          conversation.id,
          identity(company.id, privileged.user.id),
        ),
      ).resolves.toEqual({ room: `conversation:${conversation.id}` });
    }
  });

  it('denies every role of another company, even its admin', async () => {
    const company = await seedCompany();
    const other = await seedCompany();
    const conversation = await seedConversation(company);
    const foreignAdmin = await seedMember(other, 'admin');
    const foreignAgent = await seedMember(other, 'agent');

    for (const foreign of [foreignAdmin, foreignAgent]) {
      await expect(
        access.assertCanJoinConversation(
          conversation.id,
          identity(other.id, foreign.user.id),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('denies a user with no active membership and an anonymous socket', async () => {
    const company = await seedCompany();
    const outsider = await seedMember(company, 'agent');
    await dataSource
      .getRepository(CompanyMember)
      .update({ id: outsider.member.id }, { status: 'inactive' });
    const conversation = await seedConversation(company);

    await expect(
      access.canJoinConversation(
        conversation.id,
        identity(company.id, outsider.user.id),
      ),
    ).resolves.toBe(false);
    await expect(
      access.canJoinConversation(conversation.id, {
        userId: null,
        companyId: company.id,
        authenticated: false,
      }),
    ).resolves.toBe(false);
    await expect(
      access.canJoinConversation(conversation.id, {
        userId: outsider.user.id,
        companyId: null,
        authenticated: false,
      }),
    ).resolves.toBe(false);
  });

  it('resolves the active assignee with its user for the preview fanout', async () => {
    const company = await seedCompany();
    const owner = await seedMember(company);
    const queued = await seedConversation(company);
    const conversation = await seedConversation(company);
    await assign(conversation, owner.member);

    await expect(access.getActiveAssignee(conversation.id)).resolves.toEqual({
      memberId: owner.member.id,
      userId: owner.user.id,
    });
    await expect(access.getActiveAssignee(queued.id)).resolves.toBeNull();
  });
});
