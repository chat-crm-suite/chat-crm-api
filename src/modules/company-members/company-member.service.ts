// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { ClsService } from 'nestjs-cls';
import { DataSource, EntityManager, Repository, SelectQueryBuilder } from 'typeorm';

import { SessionRevocationService } from '../../auth/session/session-revocation.service';
import { WorkspaceTableCache } from '../../common/cache/workspace-table-cache.service';
import {
  CLS_COMPANY_ID,
  CLS_MEMBER_ID,
  CLS_MEMBER_ROLE,
  CLS_USER_ID,
} from '../../config/cls.keys';
import {
  WorkspaceSocketEvent,
  type CompanyMemberListQuery,
  type CreateMemberInput,
  type CreateMemberResult,
  type MemberRole,
  type MembershipClaim,
  type Presence,
  type RemoveMemberResult,
  type ResetMemberPasswordResult,
  type TeamCounts,
  type TeamMemberRow,
  type TeamTableQuery,
  type TeamTableResponse,
  type UpdateMemberInput,
} from '../../contracts/index';
import { generateInitialPassword } from '../../lib/helpers/generate-password.helper';
import { CompanySettings } from '../company/entities/company-settings.entity';
import { ConversationAssignmentService } from '../conversations/assignment/conversation-assignment.service';
import { ConversationAssignment } from '../conversations/entities/conversation-assignment.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { MemberConversationsReleasedEvent } from '../conversations/events/member-conversations-released.event';
import { PresenceService } from '../presence/presence.service';
import { User } from '../users/entities/user.entity';
import { CompanyMember } from './entities/company-member.entity';
import { MemberProvisioningService } from './member-provisioning.service';
import {
  canCreateMember,
  canManage,
  wouldLeaveWithoutAdmin,
  type TeamActor,
  type TeamDecision,
} from './team.policy';

/** Rows and counts live this long in Redis (presence is never cached). */
export const TEAM_CACHE_TTL_MS = 60_000;

const OPEN_STATUSES = ['open', 'pending'];

/** Whitelisted sort columns of the team table (`sort[].id` -> SQL). */
const SORT_COLUMNS: Record<string, string[]> = {
  name: ['user.firstName', 'user.lastName', 'user.username'],
  username: ['user.username'],
  email: ['user.email'],
  role: ['member.role'],
  status: ['member.status'],
  openConversations: ['openCount'],
  joinedAt: ['member.joinedAt'],
  lastLoginAt: ['user.lastLoginAt'],
};

/** A table row as cached: no presence, dates as ISO strings. */
type CachedRow = Omit<TeamMemberRow, 'presence' | 'joinedAt' | 'lastLoginAt'> & {
  joinedAt: string;
  lastLoginAt: string | null;
};
type CachedPage = { rows: CachedRow[]; totalItems: number };
type CachedRoster = { memberIds: string[]; byRole: TeamCounts['byRole'] };

@Injectable()
export class CompanyMemberService {
  constructor(
    @InjectRepository(CompanyMember)
    private readonly repo: Repository<CompanyMember>,
    private readonly cls: ClsService,
    private readonly dataSource: DataSource,
    private readonly provisioning: MemberProvisioningService,
    private readonly presence: PresenceService,
    private readonly assignments: ConversationAssignmentService,
    private readonly sessions: SessionRevocationService,
    private readonly cache: WorkspaceTableCache,
    @Optional() private readonly eventBus?: EventBus,
  ) {}

  private get userId(): string {
    return this.cls.get(CLS_USER_ID);
  }

  private get companyId(): string {
    return this.cls.get(CLS_COMPANY_ID);
  }

  /** Who is calling, from the verified tenant context. */
  private get actor(): TeamActor {
    return {
      memberId: this.cls.get<string>(CLS_MEMBER_ID),
      role: this.cls.get<MemberRole>(CLS_MEMBER_ROLE),
    };
  }

  /** The verified member of the active company (resolved by the tenant guard). */
  async getMemberActive(): Promise<CompanyMember | null> {
    const memberId = this.cls.get<string>(CLS_MEMBER_ID);
    if (!memberId) return null;

    return this.repo.findOne({ where: { id: memberId } });
  }

  /**
   * Token claims for every active membership of the user in a live company:
   * soft-deleted members are excluded by the entity, soft-deleted or
   * non-active (suspended) companies by the join.
   */
  async findActiveClaims(userId: string): Promise<MembershipClaim[]> {
    const members = await this.repo
      .createQueryBuilder('member')
      .innerJoin('member.company', 'company')
      .where('member.user_id = :userId', { userId })
      .andWhere('member.status = :status', { status: 'active' })
      .andWhere('company.status = :companyStatus', { companyStatus: 'active' })
      .orderBy('member.created_at', 'ASC')
      .select(['member.id', 'member.companyId', 'member.role'])
      .getMany();

    return members.map((member) => ({
      cid: member.companyId,
      mid: member.id,
      role: member.role,
    }));
  }

  /** Staff of the active company (assignment pickers); removed members never show. */
  async list(query: CompanyMemberListQuery) {
    const qb = this.repo
      .createQueryBuilder('member')
      .innerJoinAndSelect('member.user', 'user')
      .where('member.company_id = :companyId', { companyId: this.companyId })
      .andWhere('member.status = :status', { status: 'active' })
      .andWhere('user.deleted_at IS NULL')
      .orderBy('user.username', 'ASC')
      .take(query.limit);

    if (query.q) {
      qb.andWhere(
        '(user.username LIKE :q OR user.first_name LIKE :q OR user.last_name LIKE :q)',
        { q: `%${query.q}%` },
      );
    }

    const members = await qb.getMany();
    const ids = members.map((member) => member.id);
    // Assign/transfer picker: load and live presence, batched for the page.
    const [load, presence] = query.withWorkload
      ? await Promise.all([
          this.openConversationCounts(ids),
          this.presence.currentMany(this.companyId, ids),
        ])
      : [null, null];

    return members.map((member) => ({
      id: member.id,
      userId: member.userId,
      username: member.user.username,
      firstName: member.user.firstName ?? null,
      lastName: member.user.lastName ?? null,
      email: member.user.email ?? null,
      role: member.role,
      status: member.status,
      acceptsAutoAssign: member.acceptsAutoAssign,
      maxOpenConversations: member.maxOpenConversations ?? null,
      ...(load ? { openConversations: load.get(member.id) ?? 0 } : {}),
      ...(presence ? { presence: presence.get(member.id)?.state ?? 'offline' } : {}),
      joinedAt: member.joinedAt,
    }));
  }

  /** Active assignments on open/pending conversations, per member (one query). */
  private async openConversationCounts(memberIds: string[]): Promise<Map<string, number>> {
    if (!memberIds.length) return new Map();

    const rows = await this.dataSource
      .getRepository(ConversationAssignment)
      .createQueryBuilder('ca')
      .innerJoin('ca.conversation', 'conversation')
      .select('ca.member_id', 'memberId')
      .addSelect('COUNT(ca.id)', 'open')
      .where('ca.member_id IN (:...memberIds)', { memberIds })
      .andWhere('ca.unassigned_at IS NULL')
      .andWhere('conversation.status NOT IN (:...inactive)', { inactive: ['closed', 'archived'] })
      .groupBy('ca.member_id')
      .getRawMany<{ memberId: string; open: string | number }>();

    return new Map(rows.map((row) => [row.memberId, Number(row.open) || 0]));
  }

  /** Company ids the current user belongs to (the front picks the active one). */
  async getCompanies(): Promise<string[]> {
    const members = await this.repo.find({
      where: { userId: this.userId },
      select: { companyId: true },
      order: { createdAt: 'ASC' },
    });

    return [...new Set(members.map((member) => member.companyId))];
  }

  // ---------------------------------------------------------------------------
  // Equipo
  // ---------------------------------------------------------------------------

  /**
   * `POST /company-members/table`. Rows and the role counts come from Redis
   * (versioned per company); presence is always read live, for the whole
   * roster in one query, and overlaid after the cache.
   */
  async table(query: TeamTableQuery): Promise<TeamTableResponse> {
    const companyId = this.companyId;
    const roster = await this.cache.wrap<CachedRoster>(
      'team',
      companyId,
      { kind: 'roster' },
      TEAM_CACHE_TTL_MS,
      () => this.loadRoster(companyId),
    );
    const live = await this.presence.currentMany(companyId, roster.memberIds);

    const wanted = query.presence?.length ? new Set(query.presence) : null;
    const page = wanted
      ? // Depends on live presence, so it cannot be cached.
        await this.loadPage(companyId, query, [...live.values()]
          .filter((presence) => wanted.has(presence.state))
          .map((presence) => presence.memberId))
      : await this.cache.wrap<CachedPage>('team', companyId, { kind: 'page', query }, TEAM_CACHE_TTL_MS, () =>
          this.loadPage(companyId, query, null),
        );

    const byPresence = { available: 0, away: 0, offline: 0 };
    for (const presence of live.values()) byPresence[presence.state]++;

    const { perPage } = query;
    return {
      items: page.rows.map((row) => this.toRow(row, live.get(row.id))),
      meta: {
        totalItems: page.totalItems,
        itemCount: page.rows.length,
        itemsPerPage: perPage,
        totalPages: Math.ceil(page.totalItems / perPage),
        currentPage: query.page,
        counts: { byRole: roster.byRole, byPresence },
      },
    };
  }

  /** `POST /company-members`: link, create or restore, then refresh the token claims. */
  async create(input: CreateMemberInput): Promise<CreateMemberResult> {
    const companyId = this.companyId;
    const actor = this.actor;
    this.assert(canCreateMember(actor, input.role));

    const result = await this.dataSource.transaction((manager) =>
      this.provisioning.provision(manager, {
        companyId,
        email: input.email,
        role: input.role,
        username: input.username,
        firstName: input.firstName,
        lastName: input.lastName,
        phoneNumber: input.phoneNumber,
        acceptsAutoAssign: input.acceptsAutoAssign,
        maxOpenConversations: input.maxOpenConversations,
        createdByMemberId: actor.memberId,
      }),
    );

    // The user's tokens must pick up the new membership.
    await this.sessions.revoke(result.user.id);
    await this.changed(companyId, [result.member.id]);

    return {
      member: await this.rowFor(companyId, result.member.id),
      outcome: result.outcome,
      initialPassword: result.initialPassword,
    };
  }

  /** `PATCH /company-members/:id`. */
  async update(id: string, input: UpdateMemberInput): Promise<TeamMemberRow> {
    const companyId = this.companyId;
    const actor = this.actor;

    const { userId, claimsChanged } = await this.dataSource.transaction(
      async (manager) => {
        const member = await this.findInCompany(manager, companyId, id);
        this.assert(canManage(actor, { memberId: member.id, role: member.role }, input));

        await this.assertNotLastAdmin(manager, companyId, member, {
          role: input.role,
          status: input.status,
        });

        const identity = pick(input, ['firstName', 'lastName', 'phoneNumber']);
        if (Object.keys(identity).length) {
          await this.updateIdentity(manager, member.userId, identity);
        }

        const fields = pick(input, [
          'role',
          'status',
          'acceptsAutoAssign',
          'maxOpenConversations',
        ]);
        if (Object.keys(fields).length) {
          await manager.getRepository(CompanyMember).update(member.id, fields);
        }

        return {
          userId: member.userId,
          claimsChanged:
            (input.role !== undefined && input.role !== member.role) ||
            (input.status !== undefined && input.status !== member.status),
        };
      },
    );

    // Role/status live in the token claims: force a refresh.
    if (claimsChanged) await this.sessions.revoke(userId);
    await this.changed(companyId, [id]);

    return this.rowFor(companyId, id);
  }

  /**
   * `DELETE /company-members/:id`: soft delete. Open conversations go back to
   * the queue (and through auto-assign once committed), sessions are revoked.
   */
  async remove(id: string): Promise<RemoveMemberResult> {
    const companyId = this.companyId;
    const actor = this.actor;

    const { userId, released } = await this.dataSource.transaction(
      async (manager) => {
        const member = await this.findInCompany(manager, companyId, id);
        this.assert(canManage(actor, { memberId: member.id, role: member.role }));
        await this.assertNotLastAdmin(manager, companyId, member, { removed: true });

        const released = await this.assignments.releaseConversations(manager, member.id);
        await manager.getRepository(CompanyMember).softDelete(member.id);

        return { userId: member.userId, released };
      },
    );

    await this.sessions.revoke(userId);
    await this.changed(companyId, [id]);
    if (released.length) {
      this.eventBus?.publish(new MemberConversationsReleasedEvent(companyId, released));
    }

    return { releasedConversations: released.length };
  }

  /** `POST /company-members/:id/reset-password`: new password, shown once. */
  async resetPassword(id: string): Promise<ResetMemberPasswordResult> {
    const companyId = this.companyId;
    const actor = this.actor;
    const member = await this.findInCompany(this.dataSource.manager, companyId, id);
    this.assert(canManage(actor, { memberId: member.id, role: member.role }));

    const password = generateInitialPassword();
    await this.dataSource
      .getRepository(User)
      .update(member.userId, { passwordHash: await bcrypt.hash(password, 10) });
    await this.sessions.revoke(member.userId);

    return { password };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private assert(decision: TeamDecision): void {
    if (decision.allowed) return;

    const messages = {
      self: 'You cannot do this to your own membership',
      role: 'Your role cannot manage this member',
      grant: 'Your role cannot grant that role',
    } as const;
    throw new ForbiddenException({
      code: `team_${decision.reason}`,
      message: messages[decision.reason],
    });
  }

  private async findInCompany(
    manager: EntityManager,
    companyId: string,
    id: string,
  ): Promise<CompanyMember> {
    const member = await manager
      .getRepository(CompanyMember)
      .findOne({ where: { id, companyId } });
    if (!member) throw new NotFoundException('Member not found');

    return member;
  }

  /**
   * Counts the company's active admins inside the transaction (rows locked on
   * MySQL so two concurrent demotions cannot both pass).
   */
  private async assertNotLastAdmin(
    manager: EntityManager,
    companyId: string,
    member: CompanyMember,
    change: { role?: MemberRole; status?: CompanyMember['status']; removed?: boolean },
  ): Promise<void> {
    if (member.role !== 'admin' || member.status !== 'active') return;
    if (!change.removed && change.role === undefined && change.status === undefined) return;

    const admins = manager
      .getRepository(CompanyMember)
      .createQueryBuilder('admin')
      .select('admin.id')
      .where('admin.company_id = :companyId', { companyId })
      .andWhere('admin.role = :role', { role: 'admin' })
      .andWhere('admin.status = :status', { status: 'active' });
    if (this.dataSource.options.type === 'mysql') admins.setLock('pessimistic_write');

    if (wouldLeaveWithoutAdmin(member, change, await admins.getCount())) {
      throw new ConflictException({
        code: 'last_admin',
        message: 'The company needs at least one active admin',
      });
    }
  }

  /** Identity belongs to the account: only editable when it is not shared. */
  private async updateIdentity(
    manager: EntityManager,
    userId: string,
    fields: Pick<UpdateMemberInput, 'firstName' | 'lastName' | 'phoneNumber'>,
  ): Promise<void> {
    const memberships = await manager.getRepository(CompanyMember).count({ where: { userId } });
    if (memberships > 1) {
      throw new ConflictException({
        code: 'shared_account',
        message: 'This account belongs to several companies; its owner edits it from the profile',
      });
    }

    const users = manager.getRepository(User);
    if (fields.phoneNumber?.trim()) {
      const taken = await users
        .createQueryBuilder('user')
        .withDeleted()
        .where('user.phone_number = :phone', { phone: fields.phoneNumber })
        .andWhere('user.id != :userId', { userId })
        .getExists();
      if (taken) {
        throw new ConflictException({
          code: 'phone_taken',
          message: 'That phone number belongs to another account',
        });
      }
    }

    // A blank field means "remove it": store NULL, never '' (phone_number is
    // unique, so two people clearing it would otherwise collide).
    const values = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value?.trim() ? value : null]),
    );
    await users.update(userId, values);
  }

  /** Marks the table stale and tells open screens of the company. */
  private changed(companyId: string, ids: string[]): Promise<void> {
    return this.cache.invalidate('team', companyId, WorkspaceSocketEvent.TeamChanged, ids);
  }

  /** One fresh row (mutation results): never cached, presence read live. */
  private async rowFor(companyId: string, memberId: string): Promise<TeamMemberRow> {
    const page = await this.loadPage(
      companyId,
      { page: 1, perPage: 1, sort: [] },
      [memberId],
    );
    const live = await this.presence.currentMany(companyId, [memberId]);
    if (!page.rows[0]) throw new NotFoundException('Member not found');

    return this.toRow(page.rows[0], live.get(memberId));
  }

  private toRow(row: CachedRow, presence?: Presence): TeamMemberRow {
    return {
      ...row,
      joinedAt: new Date(row.joinedAt),
      lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt) : null,
      presence: presence ?? { memberId: row.id, state: 'offline', since: new Date() },
    };
  }

  /** Every non-removed member of the company: ids and role counts (ignores filters). */
  private async loadRoster(companyId: string): Promise<CachedRoster> {
    const rows = await this.repo
      .createQueryBuilder('member')
      .innerJoin('member.user', 'user')
      .select('member.id', 'id')
      .addSelect('member.role', 'role')
      .where('member.company_id = :companyId', { companyId })
      .getRawMany<{ id: string; role: MemberRole }>();

    const byRole = { admin: 0, supervisor: 0, agent: 0 };
    for (const row of rows) byRole[row.role]++;

    return { memberIds: rows.map((row) => row.id), byRole };
  }

  /**
   * One page of the table. `onlyIds` narrows to a set (presence filter, single
   * row); an empty set is an empty page.
   */
  private async loadPage(
    companyId: string,
    query: TeamTableQuery,
    onlyIds: string[] | null,
  ): Promise<CachedPage> {
    if (onlyIds && !onlyIds.length) return { rows: [], totalItems: 0 };

    const settings = await this.dataSource
      .getRepository(CompanySettings)
      .findOne({ where: { companyId } });
    const defaultCapacity =
      settings && settings.autoAssignMaxOpen > 0 ? settings.autoAssignMaxOpen : null;

    const filtered = () => this.filteredQuery(companyId, query, onlyIds);
    const totalItems = await filtered().getCount();

    const qb = filtered();
    const sorts = query.sort.flatMap((sort) =>
      (SORT_COLUMNS[sort.id] ?? []).map((column) => [column, sort.desc ? 'DESC' : 'ASC'] as const),
    );
    if (!sorts.length) sorts.push(['user.username', 'ASC']);
    sorts.forEach(([column, order], index) =>
      index === 0 ? qb.orderBy(column, order) : qb.addOrderBy(column, order),
    );
    // Stable paging when the sort column ties.
    qb.addOrderBy('member.id', 'ASC');

    const { entities, raw } = await qb
      .offset((query.page - 1) * query.perPage)
      .limit(query.perPage)
      .getRawAndEntities<{ openCount: string | number }>();

    const rows = entities.map((member, index): CachedRow => ({
      id: member.id,
      userId: member.userId,
      username: member.user.username,
      firstName: member.user.firstName ?? null,
      lastName: member.user.lastName ?? null,
      email: member.user.email ?? null,
      role: member.role,
      status: member.status,
      acceptsAutoAssign: member.acceptsAutoAssign,
      maxOpenConversations: member.maxOpenConversations ?? null,
      joinedAt: new Date(member.joinedAt).toISOString(),
      avatarUrl: member.user.avatarUrl ?? null,
      phoneNumber: member.user.phoneNumber ?? null,
      lastLoginAt: member.user.lastLoginAt
        ? new Date(member.user.lastLoginAt).toISOString()
        : null,
      openConversations: Number(raw[index]?.openCount ?? 0),
      capacity: member.maxOpenConversations ?? defaultCapacity,
    }));

    return { rows, totalItems };
  }

  private filteredQuery(
    companyId: string,
    query: TeamTableQuery,
    onlyIds: string[] | null,
  ): SelectQueryBuilder<CompanyMember> {
    const qb = this.repo
      .createQueryBuilder('member')
      .innerJoinAndSelect('member.user', 'user')
      .leftJoin(
        (sub) =>
          sub
            .select('c.assigned_member_id', 'member_id')
            .addSelect('COUNT(*)', 'cnt')
            .from(Conversation, 'c')
            .where('c.company_id = :companyId')
            .andWhere('c.status IN (:...openStatuses)')
            .andWhere('c.assigned_member_id IS NOT NULL')
            .groupBy('c.assigned_member_id'),
        'oc',
        'oc.member_id = member.id',
      )
      .addSelect('COALESCE(oc.cnt, 0)', 'openCount')
      .where('member.company_id = :companyId', { companyId })
      .setParameter('openStatuses', OPEN_STATUSES);

    if (query.role?.length) qb.andWhere('member.role IN (:...roles)', { roles: query.role });
    if (query.status?.length) {
      qb.andWhere('member.status IN (:...statuses)', { statuses: query.status });
    }
    if (onlyIds) qb.andWhere('member.id IN (:...onlyIds)', { onlyIds });
    if (query.q) {
      qb.andWhere(
        '(user.username LIKE :q OR user.first_name LIKE :q OR user.last_name LIKE :q OR user.email LIKE :q)',
        { q: `%${query.q}%` },
      );
    }

    return qb;
  }
}

function pick<T extends object, K extends keyof T>(source: T, keys: K[]): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }

  return result;
}
