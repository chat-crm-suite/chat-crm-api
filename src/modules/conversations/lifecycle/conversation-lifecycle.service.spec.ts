// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DataSource, DataSourceOptions, IsNull } from 'typeorm';

import { inboxSeed } from '@helpers/inbox-seed';
import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from '@helpers/test-database.helper';
import { CasesService } from '../../cases/cases.service';
import { CaseReply } from '../../cases/entities/case-reply.entity';
import { Case } from '../../cases/entities/case.entity';
import type { CompanyMember } from '../../company-members/entities/company-member.entity';
import { ConversationAssignmentService } from '../assignment/conversation-assignment.service';
import { ConversationAssignment } from '../entities/conversation-assignment.entity';
import { Conversation } from '../entities/conversation.entity';
import { ConversationListService } from '../listing/conversation-list.service';
import { ConversationAccessService } from '../realtime/conversation-access.service';
import {
  ConversationLifecycleService,
  type LifecycleActor,
} from './conversation-lifecycle.service';

jest.setTimeout(60_000);

const logger = { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

/** Resolve / pending / reopen / release / transfer on SQLite, events mocked. */
describe('ConversationLifecycleService', () => {
  let dataSource: DataSource;
  let seed: ReturnType<typeof inboxSeed>;
  let lifecycle: ConversationLifecycleService;
  let cases: CasesService;
  const fanout = { emitStatusChanged: jest.fn() };
  const notifier = { notifyAssigned: jest.fn(), notifyUnassigned: jest.fn() };
  const eventBus = { publish: jest.fn() };

  beforeAll(async () => {
    dataSource = new DataSource(getTestSQLiteConfig(getSQLiteEntities()) as DataSourceOptions);
    await dataSource.initialize();
    seed = inboxSeed(dataSource);

    const assignments = new ConversationAssignmentService(dataSource, logger as never);
    cases = new CasesService(
      dataSource.getRepository(Case),
      dataSource.getRepository(CaseReply),
      dataSource,
      logger as never,
    );
    lifecycle = new ConversationLifecycleService(
      dataSource,
      cases,
      new ConversationAccessService(dataSource, assignments, logger as never),
      assignments,
      notifier as never,
      fanout as never,
      new ConversationListService(dataSource),
      logger as never,
      eventBus as never,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    jest.clearAllMocks();
  });

  const actor = (member: CompanyMember): LifecycleActor => ({
    companyId: member.companyId,
    memberId: member.id,
    role: member.role,
    userId: member.userId,
  });
  const reload = (id: string) => dataSource.getRepository(Conversation).findOneByOrFail({ id });

  it('resolves: closes the case, the conversation and releases the owner', async () => {
    const company = await seed.company();
    const agent = await seed.member(company);
    const { conversation } = await seed.conversation(company, { assignee: agent });
    await cases.ensureOpen(conversation.id);

    const result = await lifecycle.resolve(conversation.id, actor(agent), 'done');

    expect(result).toMatchObject({ status: 'closed', assignee: null, case: { status: 'closed' } });
    expect(await reload(conversation.id)).toMatchObject({
      status: 'closed',
      assignedMemberId: null,
      closedByMemberId: agent.id,
    });
    const closedCase = await dataSource.getRepository(Case).findOneByOrFail({ conversationId: conversation.id });
    expect(closedCase).toMatchObject({ closeNote: 'done', ownerMemberId: agent.id });
    expect(
      await dataSource.getRepository(ConversationAssignment).countBy({
        conversationId: conversation.id,
        unassignedAt: IsNull(),
      }),
    ).toBe(0);
    expect(fanout.emitStatusChanged).toHaveBeenCalledWith(
      company.id,
      expect.objectContaining({ status: 'closed', previousStatus: 'open', byMemberId: agent.id }),
    );
    expect(eventBus.publish).toHaveBeenCalled();
  });

  it('reopens on inbound only from pending or closed, and announces it once', async () => {
    const company = await seed.company();
    const agent = await seed.member(company);
    const { conversation } = await seed.conversation(company, { assignee: agent });

    expect(await lifecycle.reopenOnInbound(conversation.id)).toBe(false);

    await lifecycle.setPending(conversation.id, actor(agent));
    fanout.emitStatusChanged.mockClear();
    expect(await lifecycle.reopenOnInbound(conversation.id)).toBe(true);
    expect(await lifecycle.reopenOnInbound(conversation.id)).toBe(false);
    expect((await reload(conversation.id)).status).toBe('open');
    expect(fanout.emitStatusChanged).toHaveBeenCalledTimes(1);
    expect(fanout.emitStatusChanged).toHaveBeenCalledWith(
      company.id,
      expect.objectContaining({ status: 'open', previousStatus: 'pending', byMemberId: null }),
    );
  });

  it('keeps the owner on hold and opens a case on reopen', async () => {
    const company = await seed.company();
    const agent = await seed.member(company, 'agent', 'Ana');
    const { conversation } = await seed.conversation(company, { assignee: agent });

    expect(await lifecycle.setPending(conversation.id, actor(agent))).toMatchObject({
      status: 'pending',
      assignee: { memberId: agent.id, userId: agent.userId, name: 'Ana' },
    });
    expect(await lifecycle.reopen(conversation.id, actor(agent))).toMatchObject({
      status: 'open',
      case: { status: 'open' },
    });
  });

  it('lets only the owner, an admin or a supervisor release or transfer', async () => {
    const company = await seed.company();
    const owner = await seed.member(company);
    const peer = await seed.member(company);
    const supervisor = await seed.member(company, 'supervisor');
    const { conversation } = await seed.conversation(company, { assignee: owner });

    // A peer agent cannot even reach someone else's thread.
    await expect(lifecycle.release(conversation.id, actor(peer))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      lifecycle.transfer(conversation.id, actor(supervisor), { memberId: owner.id }),
    ).rejects.toBeInstanceOf(ConflictException);

    const transferred = await lifecycle.transfer(conversation.id, actor(owner), {
      memberId: peer.id,
      note: 'VIP',
    });
    expect(transferred.assignee?.memberId).toBe(peer.id);
    const active = await dataSource
      .getRepository(ConversationAssignment)
      .findOneByOrFail({ conversationId: conversation.id, unassignedAt: IsNull() });
    expect(active).toMatchObject({ reason: 'transfer', note: 'VIP', assignedByMemberId: owner.id });
    expect(notifier.notifyAssigned).toHaveBeenCalledWith(conversation.id, peer.id, {
      actorMemberId: owner.id,
    });

    const released = await lifecycle.release(conversation.id, actor(supervisor), 'end of shift');
    expect(released).toMatchObject({ status: 'open', assignee: null });
    const release = await dataSource
      .getRepository(ConversationAssignment)
      .findOneByOrFail({ conversationId: conversation.id, reason: 'release' });
    expect(release).toMatchObject({ memberId: peer.id, note: 'end of shift' });
    expect(notifier.notifyUnassigned).toHaveBeenCalledWith(conversation.id, company.id, {
      actorMemberId: supervisor.id,
    });
  });

  it('refuses a conversation of another company, even to its admin', async () => {
    const company = await seed.company();
    const other = await seed.company();
    const foreignAdmin = await seed.member(other, 'admin');
    const { conversation } = await seed.conversation(company);

    await expect(lifecycle.resolve(conversation.id, actor(foreignAdmin))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
