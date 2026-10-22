// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import {
  DataSource,
  In,
  Repository,
  type EntityTarget,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from 'typeorm';

import { SessionRevocationService } from '../../auth/session/session-revocation.service';
import {
  CHANNEL_STATUS,
  type PlatformCompanyQuery,
  type PlatformCompanyRow,
  type PlatformCompanyTableResponse,
  type PlatformCreateCompanyInput,
  type PlatformCreateCompanyResult,
  type PlatformDeleteCompanyResult,
  type PlatformUpdateCompanyInput,
} from '../../contracts/index';
import { Channel } from '../channels/entities/channel.entity';
import { createCompanyWithDefaults } from '../company/company-provisioning';
import { Company } from '../company/entities/company.entity';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import {
  MemberProvisioningService,
  type ProvisionMemberResult,
} from '../company-members/member-provisioning.service';
import { Customer } from '../customers/entities/customer.entity';

type CountKey = 'membersCount' | 'customersCount' | 'channelsCount';
type Counts = Record<CountKey, number>;

/**
 * The live rows that hang from a company. Queried through their entities, so
 * TypeORM adds the soft-delete filter (`@DeleteDateColumn`) by itself; every
 * count is driven by an index that starts with `company_id`.
 */
const COUNTED: Record<
  CountKey,
  {
    entity: EntityTarget<ObjectLiteral>;
    scope?: (qb: SelectQueryBuilder<ObjectLiteral>, alias: string) => void;
  }
> = {
  membersCount: { entity: CompanyMember },
  customersCount: { entity: Customer },
  // Configured channels only: every company is born with a `pending` one.
  channelsCount: {
    entity: Channel,
    scope: (qb, alias) => {
      qb.andWhere(`${alias}.status != :pendingStatus`, {
        pendingStatus: CHANNEL_STATUS.pending,
      });
    },
  },
};

/** Company columns the table can be sorted by (`sort[].id`), besides counts. */
const SORTABLE_COLUMNS = {
  name: 'c.name',
  status: 'c.status',
  createdAt: 'c.createdAt',
} as const;

const isCountKey = (id: string): id is CountKey => id in COUNTED;
const isSortableColumn = (id: string): id is keyof typeof SORTABLE_COLUMNS =>
  id in SORTABLE_COLUMNS;

const isUniqueViolation = (error: unknown): boolean => {
  const { code, errno } = (error as { code?: string; errno?: number }) ?? {};
  const driver = (error as { driverError?: { code?: string; errno?: number } })
    ?.driverError;

  return [code, driver?.code].some((c) =>
    ['ER_DUP_ENTRY', 'SQLITE_CONSTRAINT_UNIQUE'].includes(c ?? ''),
  ) || [errno, driver?.errno].includes(1062);
};

/**
 * Companies management of the platform console. Soft delete only: a deleted
 * or suspended company drops out of every member token (`findActiveClaims`),
 * so each change that alters who can reach a company also revokes the sessions
 * of its members, which then refresh transparently. Every mutation is
 * audit-logged with the acting user.
 */
@Injectable()
export class PlatformCompaniesService {
  constructor(
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(CompanyMember)
    private readonly members: Repository<CompanyMember>,
    private readonly dataSource: DataSource,
    private readonly provisioning: MemberProvisioningService,
    private readonly sessions: SessionRevocationService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlatformCompaniesService.name);
  }

  async table(query: PlatformCompanyQuery): Promise<PlatformCompanyTableResponse> {
    const base = this.filtered(query);
    const totalItems = await base.clone().getCount();

    // The page holds company ids only; their counts are fetched afterwards
    // for those ids. Sorting by a count is the one case that must compute it
    // for every filtered company, so only that count joins as a subquery.
    const page = base.clone().select('c.id', 'id');
    const sorts = query.sort.filter(
      (s) => isSortableColumn(s.id) || isCountKey(s.id),
    );
    if (sorts.length) {
      sorts.forEach((s, index) => {
        const direction = s.desc ? 'DESC' : 'ASC';
        let column: string;
        if (isCountKey(s.id)) {
          const key = s.id;
          page.addSelect(
            (sub: SelectQueryBuilder<ObjectLiteral>) => this.countSubQuery(sub, key),
            key,
          );
          column = key;
        } else {
          column = SORTABLE_COLUMNS[s.id as keyof typeof SORTABLE_COLUMNS];
        }
        if (index === 0) page.orderBy(column, direction);
        else page.addOrderBy(column, direction);
      });
    } else {
      page.orderBy('c.createdAt', 'DESC');
    }
    page.addOrderBy('c.id', 'ASC');

    const rows = await page
      .offset((query.page - 1) * query.perPage)
      .limit(query.perPage)
      .getRawMany<{ id: string }>();
    const items = await this.hydrate(rows.map((row) => row.id));

    return {
      items,
      meta: {
        totalItems,
        itemCount: items.length,
        itemsPerPage: query.perPage,
        totalPages: Math.ceil(totalItems / query.perPage),
        currentPage: query.page,
      },
    };
  }

  async create(
    dto: PlatformCreateCompanyInput,
    actorUserId: string,
  ): Promise<PlatformCreateCompanyResult> {
    const { admin, ...profile } = dto;

    let created: { company: Company; first: ProvisionMemberResult | null };
    try {
      created = await this.dataSource.transaction(async (manager) => {
        await this.assertEmailFree(profile.email);

        const company = await createCompanyWithDefaults(manager, profile);
        const first = admin
          ? await this.provisioning.provision(manager, {
              companyId: company.id,
              email: admin.email,
              role: 'admin',
              username: admin.username,
              firstName: admin.firstName,
              lastName: admin.lastName,
              createdByMemberId: null,
            })
          : null;

        return { company, first };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw this.emailTaken();
      throw error;
    }

    // An existing account that got linked needs a token with the new company.
    if (created.first) await this.sessions.revoke(created.first.user.id);

    this.audit('company_created', actorUserId, created.company.id, {
      adminOutcome: created.first?.outcome ?? null,
    });

    return {
      company: await this.rowOf(created.company.id),
      adminOutcome: created.first?.outcome ?? null,
      initialPassword: created.first?.initialPassword,
    };
  }

  async update(
    id: string,
    dto: PlatformUpdateCompanyInput,
    actorUserId: string,
  ): Promise<PlatformCompanyRow> {
    const company = await this.findLive(id);
    await this.assertEmailFree(dto.email, id);

    try {
      if (Object.keys(dto).length) await this.companies.update(id, dto);
    } catch (error) {
      if (isUniqueViolation(error)) throw this.emailTaken();
      throw error;
    }

    // Reaching the company depends on its status: members pick the change up
    // through a transparent token refresh.
    const statusChanged = dto.status !== undefined && dto.status !== company.status;
    const affectedMembers = statusChanged ? await this.revokeMembers(id) : 0;

    this.audit('company_updated', actorUserId, id, {
      fields: Object.keys(dto),
      status: dto.status,
      affectedMembers,
    });

    return this.rowOf(id);
  }

  async remove(id: string, actorUserId: string): Promise<PlatformDeleteCompanyResult> {
    await this.findLive(id);

    await this.companies.softDelete(id);
    const affectedMembers = await this.revokeMembers(id);

    this.audit('company_deleted', actorUserId, id, { affectedMembers });

    return { affectedMembers };
  }

  async restore(id: string, actorUserId: string): Promise<PlatformCompanyRow> {
    const company = await this.companies.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!company) throw new NotFoundException('Company not found');

    if (company.deletedAt) {
      await this.companies.restore(id);
      // Members get the company back in their claims on the next refresh.
      await this.revokeMembers(id);
      this.audit('company_restored', actorUserId, id);
    }

    return this.rowOf(id);
  }

  // ---------------------------------------------------------------------------

  private filtered(query: PlatformCompanyQuery): SelectQueryBuilder<Company> {
    const qb = this.companies.createQueryBuilder('c');
    if (query.includeDeleted) qb.withDeleted();

    const q = query.q?.trim().toLowerCase();
    if (q) {
      qb.andWhere('(LOWER(c.name) LIKE :q OR LOWER(c.email) LIKE :q)', {
        q: `%${q}%`,
      });
    }
    if (query.status?.length) {
      qb.andWhere('c.status IN (:...statuses)', { statuses: query.status });
    }

    return qb;
  }

  /** `(SELECT COUNT(*) ...)` correlated with `c.id`, to sort by a count. */
  private countSubQuery(
    sub: SelectQueryBuilder<ObjectLiteral>,
    key: CountKey,
  ): SelectQueryBuilder<ObjectLiteral> {
    const { entity, scope } = COUNTED[key];
    const qb = sub
      .select('COUNT(*)')
      .from(entity, key)
      .where(`${key}.companyId = c.id`);
    scope?.(qb, key);

    return qb;
  }

  /**
   * One grouped query per counted table, bounded to the given companies (a
   * page: at most `perPage` ids): `WHERE company_id IN (...) GROUP BY company_id`.
   */
  private async countsFor(ids: string[]): Promise<Map<string, Counts>> {
    const counts = new Map<string, Counts>(
      ids.map((id) => [
        id,
        { membersCount: 0, customersCount: 0, channelsCount: 0 },
      ]),
    );

    await Promise.all(
      (Object.keys(COUNTED) as CountKey[]).map(async (key) => {
        const { entity, scope } = COUNTED[key];
        const qb = this.dataSource
          .getRepository(entity)
          .createQueryBuilder('x')
          .select('x.companyId', 'companyId')
          .addSelect('COUNT(*)', 'total')
          .where('x.companyId IN (:...ids)', { ids })
          .groupBy('x.companyId');
        scope?.(qb, 'x');

        const rows = await qb.getRawMany<{
          companyId: string;
          total: number | string;
        }>();
        for (const row of rows) {
          const entry = counts.get(row.companyId);
          if (entry) entry[key] = Number(row.total);
        }
      }),
    );

    return counts;
  }

  /** Row shape of one company, deleted or not. */
  private async rowOf(id: string): Promise<PlatformCompanyRow> {
    const [row] = await this.hydrate([id]);
    if (!row) throw new NotFoundException('Company not found');

    return row;
  }

  /** Company rows with their counts, keeping the order of `ids`. */
  private async hydrate(ids: string[]): Promise<PlatformCompanyRow[]> {
    if (!ids.length) return [];

    const [entities, counts] = await Promise.all([
      this.companies.find({ where: { id: In(ids) }, withDeleted: true }),
      this.countsFor(ids),
    ]);
    const byId = new Map(entities.map((company) => [company.id, company]));

    return ids.flatMap((id) => {
      const company = byId.get(id);
      const row = counts.get(id);
      if (!company || !row) return [];

      return [
        {
          id: company.id,
          name: company.name,
          email: company.email ?? null,
          phoneNumber: company.phoneNumber ?? null,
          address: company.address ?? null,
          timezone: company.timezone,
          status: company.status,
          membersCount: row.membersCount,
          customersCount: row.customersCount,
          channelsCount: row.channelsCount,
          createdAt: company.createdAt,
          deletedAt: company.deletedAt ?? null,
        },
      ];
    });
  }

  private async findLive(id: string): Promise<Company> {
    const company = await this.companies.findOne({ where: { id } });
    if (!company) throw new NotFoundException('Company not found');

    return company;
  }

  /** Revokes the sessions of every (not removed) member; returns how many. */
  private async revokeMembers(companyId: string): Promise<number> {
    const members = await this.members.find({
      where: { companyId },
      select: { id: true, userId: true },
    });

    const userIds = new Set(members.map((member) => member.userId));
    for (const userId of userIds) await this.sessions.revoke(userId);

    return members.length;
  }

  private async assertEmailFree(email: string | undefined, exceptId?: string) {
    if (!email) return;

    const existing = await this.companies.findOne({
      where: { email },
      withDeleted: true,
      select: { id: true },
    });
    if (existing && existing.id !== exceptId) throw this.emailTaken();
  }

  private emailTaken() {
    return new ConflictException({
      code: 'company_email_taken',
      message: 'That email belongs to another company',
    });
  }

  private audit(
    event: string,
    userId: string,
    companyId: string,
    extra: Record<string, unknown> = {},
  ): void {
    this.logger.info(
      { audit: 'platform', event, userId, companyId, ...extra },
      `platform console: ${event}`,
    );
  }
}
