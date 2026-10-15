// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Readable } from 'stream';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CsvParser } from 'nest-csv-parser';
import { ClsService } from 'nestjs-cls';
import { In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';

import { WorkspaceTableCache } from '../../common/cache/workspace-table-cache.service';
import { CLS_COMPANY_ID } from '../../config/cls.keys';
import {
  CustomerRowSchema,
  NO_OWNER_FILTER,
  paginatedSchema,
  WorkspaceSocketEvent,
  type BulkDeleteCustomersResult,
  type CreateCustomerInput,
  type CreateTagInput,
  type CustomerImportResult,
  type CustomerMutationResult,
  type CustomerRow,
  type CustomerTableQuery,
  type SetCustomerTagsInput,
  type Tag as TagDto,
  type UpdateCustomerInput,
} from '../../contracts/index';
import {
  isDuplicateEntryError,
  normalizePhoneNumber,
} from '../../lib/helpers/phone.helper';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { CreateCustomerDto } from './dto/customer.dto';
import { CustomerIdentity } from './entities/customer-identity.entity';
import { CustomerTag } from './entities/customer-tag.entity';
import { Customer } from './entities/customer.entity';
import { PipelineStage } from './entities/pipeline-stage.entity';
import { Tag } from './entities/tag.entity';

/** Table pages live this long in Redis. */
export const CUSTOMERS_CACHE_TTL_MS = 30_000;

const OPEN_STATUSES = ['open', 'pending'] as const;
const IMPORT_CHUNK = 200;

/** Whitelisted sort columns of the customers table (`sort[].id` -> SQL). */
const SORT_COLUMNS: Record<string, string[]> = {
  displayName: ['customer.displayName'],
  email: ['customer.email'],
  phoneNumber: ['customer.phoneNumber'],
  source: ['customer.source'],
  stage: ['stage.position'],
  conversationsCount: ['conversationsCount'],
  lastInteractionAt: ['customer.lastInteractionAt'],
  createdAt: ['customer.createdAt'],
};
/** Columns where a missing value sorts after every real one. */
const NULLS_LAST = new Set(['customer.lastInteractionAt']);

const CustomerPageSchema = paginatedSchema(CustomerRowSchema);
type CustomerPage = ReturnType<typeof CustomerPageSchema.parse>;

/** Writable fields; `null` clears the owner or the stage on update. */
type CustomerFields = Omit<CreateCustomerInput, 'pipelineStageId' | 'ownerMemberId'> &
  Pick<UpdateCustomerInput, 'pipelineStageId' | 'ownerMemberId'>;

/**
 * Customers of the active company. Every query is scoped by the company of
 * the verified tenant context (a foreign id is a 404, never data); the
 * webhook path passes its company explicitly.
 */
@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(CustomerIdentity)
    private readonly identities: Repository<CustomerIdentity>,
    private readonly csv: CsvParser,
    private readonly cls: ClsService,
    @Optional() private readonly cache?: WorkspaceTableCache,
  ) {}

  private get companyId(): string {
    const companyId = this.cls.get<string | undefined>(CLS_COMPANY_ID);
    if (!companyId) throw new BadRequestException('Company context required');

    return companyId;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** `POST /customers/table`. Pages are cached 30 s per company and query. */
  async table(query: CustomerTableQuery): Promise<CustomerPage> {
    const companyId = this.companyId;
    const compute = () => this.loadPage(companyId, query);
    const page = this.cache
      ? await this.cache.wrap('customers', companyId, query, CUSTOMERS_CACHE_TTL_MS, compute)
      : await compute();

    // A cached page comes back from JSON: this restores the dates.
    return CustomerPageSchema.parse(page);
  }

  /** `GET /customers/search` (Ctrl+K): a few matches by name, phone or email. */
  async search(q: string = '', limit: number = 10): Promise<Customer[]> {
    const qb = this.customers
      .createQueryBuilder('customer')
      .where('customer.companyId = :companyId', { companyId: this.companyId })
      .orderBy('customer.displayName', 'ASC')
      .addOrderBy('customer.id', 'ASC')
      .take(limit);
    this.applyText(qb, q.trim());

    return qb.getMany();
  }

  /** Every customer of the company (kept for callers of `GET /customers`). */
  findAll(): Promise<Customer[]> {
    return this.customers.find({
      where: { companyId: this.companyId },
      order: { createdAt: 'DESC' },
    });
  }

  findByPhone(phoneNumber: string): Promise<Customer | null> {
    return this.customers.findOne({
      where: {
        companyId: this.companyId,
        phoneNumber: normalizePhoneNumber(phoneNumber),
      },
    });
  }

  /** Pipeline stages of the company, in board order. */
  listStages(): Promise<PipelineStage[]> {
    return this.customers.manager.getRepository(PipelineStage).find({
      where: { companyId: this.companyId },
      order: { position: 'ASC', name: 'ASC' },
    });
  }

  listTags(): Promise<Tag[]> {
    return this.customers.manager.getRepository(Tag).find({
      where: { companyId: this.companyId },
      order: { name: 'ASC' },
    });
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /**
   * `POST /customers`. A soft-deleted customer with the same phone is brought
   * back with the payload applied (`restored: true`); an active one is a 409.
   */
  async create(dto: CreateCustomerInput): Promise<CustomerMutationResult> {
    const companyId = this.companyId;
    const phoneNumber = this.cleanPhone(dto.phoneNumber);
    await this.assertReferences(companyId, dto);

    const fields = { ...dto, phoneNumber };
    const found = phoneNumber
      ? await this.customers.findOne({
          where: { companyId, phoneNumber },
          withDeleted: true,
        })
      : null;

    let customer: Customer;
    let restored = false;
    if (found && !found.deletedAt) {
      throw this.conflict(found.id);
    } else if (found) {
      customer = await this.restoreWith(found.id, fields);
      restored = true;
    } else {
      try {
        customer = await this.customers.save(
          this.customers.create({ ...fields, companyId }),
        );
      } catch (error) {
        if (!isDuplicateEntryError(error) || !phoneNumber) throw error;
        const winner = await this.customers.findOne({ where: { companyId, phoneNumber } });
        throw winner ? this.conflict(winner.id) : error;
      }
    }

    await this.changed(companyId, [customer.id]);

    return { customer: await this.rowFor(companyId, customer.id), restored };
  }

  /** `PATCH /customers/:id`. */
  async update(id: string, dto: UpdateCustomerInput): Promise<CustomerMutationResult> {
    const companyId = this.companyId;
    const customer = await this.findOwned(companyId, id);
    await this.assertReferences(companyId, dto);

    const fields: Partial<CustomerFields> = { ...dto };
    if (dto.phoneNumber !== undefined) {
      fields.phoneNumber = this.cleanPhone(dto.phoneNumber);
      if (fields.phoneNumber && fields.phoneNumber !== customer.phoneNumber) {
        await this.claimPhone(companyId, id, fields.phoneNumber);
      }
    }

    if (Object.keys(fields).length) await this.customers.update(id, fields);
    await this.changed(companyId, [id]);

    return { customer: await this.rowFor(companyId, id), restored: false };
  }

  /** `DELETE /customers/:id` (soft). */
  async remove(id: string): Promise<BulkDeleteCustomersResult> {
    const companyId = this.companyId;
    const result = await this.customers.softDelete({
      id,
      companyId,
      deletedAt: IsNull(),
    });
    if (!result.affected) throw new NotFoundException('Customer not found');

    await this.changed(companyId, [id]);

    return { deleted: 1 };
  }

  /** `POST /customers/bulk-delete`: ids of other companies are simply not touched. */
  async bulkDelete(ids: string[]): Promise<BulkDeleteCustomersResult> {
    const companyId = this.companyId;
    const result = await this.customers.softDelete({
      id: In([...new Set(ids)]),
      companyId,
      deletedAt: IsNull(),
    });
    const deleted = result.affected ?? 0;
    if (deleted) await this.changed(companyId, ids);

    return { deleted };
  }

  /** `POST /customers/tags`: unique by name within the company. */
  async createTag(dto: CreateTagInput): Promise<Tag> {
    const companyId = this.companyId;
    const tags = this.customers.manager.getRepository(Tag);
    const existing = await tags.findOne({ where: { companyId, name: dto.name } });
    if (existing) throw this.tagConflict(existing.id);

    try {
      const tag = await tags.save(tags.create({ companyId, name: dto.name, color: dto.color }));
      await this.changed(companyId);
      return tag;
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      const winner = await tags.findOne({ where: { companyId, name: dto.name } });
      throw this.tagConflict(winner?.id);
    }
  }

  /** `PUT /customers/:id/tags`: replaces the whole set. */
  async setTags(id: string, dto: SetCustomerTagsInput): Promise<CustomerRow> {
    const companyId = this.companyId;
    await this.findOwned(companyId, id);

    const tagIds = [...new Set(dto.tagIds)];
    await this.customers.manager.transaction(async (manager) => {
      if (tagIds.length) {
        const known = await manager.getRepository(Tag).count({
          where: { companyId, id: In(tagIds) },
        });
        if (known !== tagIds.length) {
          throw new BadRequestException({
            code: 'unknown_tag',
            message: 'Some tags do not belong to this company',
          });
        }
      }

      const links = manager.getRepository(CustomerTag);
      await links.delete({ customerId: id });
      if (tagIds.length) {
        await links.insert(tagIds.map((tagId) => ({ customerId: id, tagId })));
      }
    });
    await this.changed(companyId, [id]);

    return this.rowFor(companyId, id);
  }

  /**
   * `POST /customers/import`. Creates new phones, restores soft-deleted ones
   * and skips what already exists (or repeats inside the file).
   */
  async importCsv(file: Express.Multer.File): Promise<CustomerImportResult> {
    const companyId = this.companyId;
    if (!file?.buffer) throw new BadRequestException('A CSV file is required');

    const parsed = await this.csv.parse(
      Readable.from(file.buffer),
      CreateCustomerDto,
      undefined,
      undefined,
      { strict: true, separator: ',' },
    );
    const rows = (
      parsed.list as { displayName?: string; phoneNumber?: string; email?: string }[]
    ).map((row) => ({
      displayName: row.displayName?.trim() || undefined,
      email: row.email?.trim() || undefined,
      phoneNumber: row.phoneNumber ? this.cleanPhone(row.phoneNumber) : undefined,
    }));

    const result: CustomerImportResult = { created: 0, restored: 0, skipped: 0 };
    const seen = new Set<string>();
    const fresh: Partial<Customer>[] = [];
    const known = await this.knownByPhone(
      companyId,
      rows.flatMap((row) => (row.phoneNumber ? [row.phoneNumber] : [])),
    );

    for (const row of rows) {
      const { phoneNumber } = row;
      if (phoneNumber) {
        if (seen.has(phoneNumber)) {
          result.skipped++;
          continue;
        }
        seen.add(phoneNumber);

        const existing = known.get(phoneNumber);
        if (existing && !existing.deletedAt) {
          result.skipped++;
          continue;
        }
        if (existing) {
          await this.restoreWith(existing.id, { ...row, source: 'import' });
          result.restored++;
          continue;
        }
      }
      fresh.push({ companyId, ...row, source: 'import' });
    }

    for (let from = 0; from < fresh.length; from += IMPORT_CHUNK) {
      const chunk = fresh.slice(from, from + IMPORT_CHUNK);
      const { created, skipped } = await this.insertChunk(chunk);
      result.created += created;
      result.skipped += skipped;
    }

    if (result.created || result.restored) await this.changed(companyId);

    return result;
  }

  // ---------------------------------------------------------------------------
  // Inbound (webhook): the company comes from the channel, not from CLS
  // ---------------------------------------------------------------------------

  /**
   * Resolution canon (docs/database/README.md — Identity canon): the webhook resolves a customer
   * through `customer_identities(channel_id, external_id)`. `external_id` is
   * stored raw; `phone_number` is normalized to `+digits` and is informational.
   * Concurrent duplicates are tolerated by re-reading after ER_DUP_ENTRY.
   *
   * A soft-deleted customer that writes again is restored (found through its
   * identity or through its phone), so the conversation continues.
   */
  async findOrCreateIncoming(params: {
    companyId: string;
    channelId: string;
    externalId: string;
    phoneNumber?: string;
    profileName?: string;
  }): Promise<Customer> {
    const { companyId, channelId, externalId, profileName } = params;
    const phoneNumber = params.phoneNumber
      ? normalizePhoneNumber(params.phoneNumber)
      : undefined;

    const findIdentity = () =>
      this.identities.findOne({
        where: { channelId, externalId },
        relations: { customer: true },
        withDeleted: true,
      });

    let identity = await findIdentity();
    if (identity?.customer) {
      if (profileName && identity.profileName !== profileName) {
        await this.identities.update(identity.id, { profileName });
      }
      return this.touch(companyId, identity.customer);
    }

    const findCustomer = () =>
      phoneNumber
        ? this.customers.findOne({
            where: { companyId, phoneNumber },
            withDeleted: true,
          })
        : Promise.resolve(null);

    let customer = await findCustomer();
    let changed = false;

    if (!customer) {
      try {
        customer = await this.customers.save(
          this.customers.create({
            companyId,
            phoneNumber,
            displayName: profileName,
            source: 'whatsapp',
            lastInteractionAt: new Date(),
          }),
        );
        changed = true;
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        customer = await findCustomer();
        if (!customer) throw error;
      }
    }

    try {
      await this.identities.save(
        this.identities.create({
          customerId: customer.id,
          channelId,
          externalId,
          profileName,
        }),
      );
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      identity = await findIdentity();
      if (identity?.customer) return this.touch(companyId, identity.customer);
      throw error;
    }

    const resolved = await this.touch(companyId, customer);
    if (changed) await this.changed(companyId, [resolved.id]);

    return resolved;
  }

  /** Marks an inbound interaction, restoring the customer when it was deleted. */
  private async touch(companyId: string, customer: Customer): Promise<Customer> {
    const now = new Date();
    if (customer.deletedAt) {
      await this.customers.restore(customer.id);
      await this.customers.update(customer.id, { lastInteractionAt: now });
      await this.changed(companyId, [customer.id]);

      return this.customers.findOneByOrFail({ id: customer.id });
    }

    await this.customers.update(customer.id, { lastInteractionAt: now });
    customer.lastInteractionAt = now;

    return customer;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Marks the table stale and tells open screens of the company. */
  private async changed(companyId: string, ids?: readonly string[]): Promise<void> {
    await this.cache?.invalidate(
      'customers',
      companyId,
      WorkspaceSocketEvent.CustomersChanged,
      ids,
    );
  }

  private conflict(customerId: string): ConflictException {
    return new ConflictException({
      code: 'customer_exists',
      customerId,
      message: 'A customer with this phone already exists',
    });
  }

  private tagConflict(tagId?: string): ConflictException {
    return new ConflictException({
      code: 'tag_exists',
      tagId,
      message: 'A tag with this name already exists',
    });
  }

  /** `+digits`, or undefined when no phone was given; garbage is a 400. */
  private cleanPhone(raw?: string): string | undefined {
    if (!raw?.trim()) return undefined;
    const phoneNumber = normalizePhoneNumber(raw);
    if (phoneNumber.length < 2) {
      throw new BadRequestException({ code: 'invalid_phone', message: 'Invalid phone number' });
    }

    return phoneNumber;
  }

  private async findOwned(companyId: string, id: string): Promise<Customer> {
    const customer = await this.customers.findOne({ where: { id, companyId } });
    if (!customer) throw new NotFoundException('Customer not found');

    return customer;
  }

  /** `GET /customers/:id/row`: one table row of the active company (404 otherwise). */
  async findRow(id: string): Promise<CustomerRow> {
    const companyId = this.companyId;
    await this.findOwned(companyId, id);

    return this.rowFor(companyId, id);
  }

  /** A stage or owner id from another company must never be stored. */
  private async assertReferences(
    companyId: string,
    dto: Pick<UpdateCustomerInput, 'pipelineStageId' | 'ownerMemberId'>,
  ): Promise<void> {
    const { manager } = this.customers;
    if (dto.pipelineStageId) {
      const stage = await manager
        .getRepository(PipelineStage)
        .exists({ where: { id: dto.pipelineStageId, companyId } });
      if (!stage) {
        throw new BadRequestException({ code: 'unknown_stage', message: 'Unknown pipeline stage' });
      }
    }
    if (dto.ownerMemberId) {
      const owner = await manager.getRepository(CompanyMember).exists({
        where: { id: dto.ownerMemberId, companyId, status: 'active' },
      });
      if (!owner) {
        throw new BadRequestException({ code: 'unknown_owner', message: 'Unknown owner' });
      }
    }
  }

  /**
   * A phone held by a soft-deleted customer is released to the one being
   * edited (the unique index would block it); an active holder is a 409.
   */
  private async claimPhone(companyId: string, id: string, phoneNumber: string): Promise<void> {
    const holder = await this.customers.findOne({
      where: { companyId, phoneNumber },
      withDeleted: true,
    });
    if (!holder || holder.id === id) return;
    if (!holder.deletedAt) throw this.conflict(holder.id);

    await this.customers
      .createQueryBuilder()
      .update()
      .set({ phoneNumber: () => 'NULL' })
      .where('id = :id', { id: holder.id })
      .execute();
  }

  /** Brings a soft-deleted customer back, applying the provided fields. */
  private async restoreWith(
    id: string,
    fields: Partial<CustomerFields> & { source?: Customer['source'] },
  ): Promise<Customer> {
    const clean = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    await this.customers.restore(id);
    if (Object.keys(clean).length) await this.customers.update(id, clean);

    return this.customers.findOneByOrFail({ id });
  }

  /** Customers of the company by phone, soft-deleted ones included. */
  private async knownByPhone(
    companyId: string,
    phones: string[],
  ): Promise<Map<string, Customer>> {
    const found = new Map<string, Customer>();
    const unique = [...new Set(phones)];
    for (let from = 0; from < unique.length; from += 500) {
      const customers = await this.customers.find({
        where: { companyId, phoneNumber: In(unique.slice(from, from + 500)) },
        withDeleted: true,
      });
      customers.forEach((customer) => found.set(customer.phoneNumber!, customer));
    }

    return found;
  }

  /** Inserts a chunk; if a concurrent import raced us, falls back row by row. */
  private async insertChunk(
    chunk: Partial<Customer>[],
  ): Promise<{ created: number; skipped: number }> {
    if (!chunk.length) return { created: 0, skipped: 0 };

    try {
      await this.customers.save(chunk.map((row) => this.customers.create(row)));
      return { created: chunk.length, skipped: 0 };
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
    }

    let created = 0;
    let skipped = 0;
    for (const row of chunk) {
      try {
        await this.customers.save(this.customers.create(row));
        created++;
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        skipped++;
      }
    }

    return { created, skipped };
  }

  private async rowFor(companyId: string, id: string): Promise<CustomerRow> {
    const page = await this.loadPage(companyId, { page: 1, perPage: 1, sort: [] }, id);
    const row = page.items[0];
    if (!row) throw new NotFoundException('Customer not found');

    return row;
  }

  private applyText(qb: SelectQueryBuilder<Customer>, text: string): void {
    if (!text) return;

    const digits = text.replace(/\D/g, '');
    qb.andWhere(
      `(customer.displayName LIKE :q OR customer.firstName LIKE :q OR customer.lastName LIKE :q
        OR customer.phoneNumber LIKE :q OR customer.email LIKE :q${digits.length >= 3 ? ' OR customer.phoneNumber LIKE :digits' : ''})`,
      { q: `%${text}%`, digits: `%${digits}%` },
    );
  }

  private filteredQuery(
    companyId: string,
    query: CustomerTableQuery,
    onlyId?: string,
  ): SelectQueryBuilder<Customer> {
    const qb = this.customers
      .createQueryBuilder('customer')
      .leftJoinAndSelect('customer.pipelineStage', 'stage')
      .leftJoin(
        (sub) =>
          sub
            .select('cv.customer_id', 'customer_id')
            .addSelect('COUNT(*)', 'cnt')
            .from(Conversation, 'cv')
            .where('cv.company_id = :companyId')
            .groupBy('cv.customer_id'),
        'cc',
        'cc.customer_id = customer.id',
      )
      .addSelect('COALESCE(cc.cnt, 0)', 'conversationsCount')
      .where('customer.companyId = :companyId', { companyId });

    if (onlyId) qb.andWhere('customer.id = :onlyId', { onlyId });
    this.applyText(qb, query.q ?? '');

    if (query.stageId?.length) {
      qb.andWhere('customer.pipelineStageId IN (:...stageIds)', { stageIds: query.stageId });
    }
    if (query.source?.length) {
      qb.andWhere('customer.source IN (:...sources)', { sources: query.source });
    }
    if (query.ownerMemberId?.length) {
      const owners = query.ownerMemberId.filter((owner) => owner !== NO_OWNER_FILTER);
      const parts: string[] = [];
      if (owners.length !== query.ownerMemberId.length) {
        parts.push('customer.ownerMemberId IS NULL');
      }
      if (owners.length) parts.push('customer.ownerMemberId IN (:...ownerIds)');
      qb.andWhere(`(${parts.join(' OR ')})`, { ownerIds: owners });
    }
    if (query.tagId?.length) {
      qb.andWhere(
        (outer) =>
          `EXISTS ${outer
            .subQuery()
            .select('1')
            .from(CustomerTag, 'ct')
            .where('ct.customer_id = customer.id')
            .andWhere('ct.tag_id IN (:...tagIds)')
            .getQuery()}`,
      ).setParameter('tagIds', query.tagId);
    }
    if (query.lastInteractionFrom) {
      qb.andWhere('customer.lastInteractionAt >= :from', { from: new Date(query.lastInteractionFrom) });
    }
    if (query.lastInteractionTo) {
      qb.andWhere('customer.lastInteractionAt <= :to', { to: new Date(query.lastInteractionTo) });
    }

    return qb;
  }

  /** One page of rows; `onlyId` narrows to a single customer (mutation results). */
  private async loadPage(
    companyId: string,
    query: CustomerTableQuery,
    onlyId?: string,
  ): Promise<CustomerPage> {
    const totalItems = await this.filteredQuery(companyId, query, onlyId).getCount();

    const qb = this.filteredQuery(companyId, query, onlyId);
    const sorts = query.sort.flatMap((sort) =>
      (SORT_COLUMNS[sort.id] ?? []).map((column) => [column, sort.desc ? 'DESC' : 'ASC'] as const),
    );
    if (!sorts.length) sorts.push(['customer.lastInteractionAt', 'DESC'], ['customer.createdAt', 'DESC']);

    let first = true;
    for (const [column, order] of sorts) {
      if (NULLS_LAST.has(column)) {
        // MySQL has no NULLS LAST: sort the nulls apart first.
        const isNull = `CASE WHEN ${column} IS NULL THEN 1 ELSE 0 END`;
        if (first) qb.orderBy(isNull, 'ASC');
        else qb.addOrderBy(isNull, 'ASC');
        first = false;
      }
      if (first) qb.orderBy(column, order);
      else qb.addOrderBy(column, order);
      first = false;
    }
    qb.addOrderBy('customer.id', 'ASC');

    const { entities, raw } = await qb
      .offset((query.page - 1) * query.perPage)
      .limit(query.perPage)
      .getRawAndEntities<{ conversationsCount: string | number }>();

    const items = await this.toRows(
      companyId,
      entities,
      entities.map((_, index) => Number(raw[index]?.conversationsCount ?? 0)),
    );

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

  /** Adds owner, tags and the open conversation with one batched query each. */
  private async toRows(
    companyId: string,
    customers: Customer[],
    counts: number[],
  ): Promise<CustomerRow[]> {
    if (!customers.length) return [];

    const { manager } = this.customers;
    const ids = customers.map((customer) => customer.id);
    const ownerIds = [
      ...new Set(customers.flatMap((customer) => (customer.ownerMemberId ? [customer.ownerMemberId] : []))),
    ];

    const [links, owners, open] = await Promise.all([
      manager
        .getRepository(CustomerTag)
        .createQueryBuilder('link')
        .innerJoinAndSelect('link.tag', 'tag')
        .where('link.customer_id IN (:...ids)', { ids })
        .orderBy('tag.name', 'ASC')
        .getMany(),
      // A removed owner keeps showing as the historic owner.
      ownerIds.length
        ? manager.getRepository(CompanyMember).find({
            where: { id: In(ownerIds), companyId },
            relations: { user: true },
            withDeleted: true,
          })
        : Promise.resolve([] as CompanyMember[]),
      manager.getRepository(Conversation).find({
        where: { companyId, customerId: In(ids), status: In([...OPEN_STATUSES]) },
        order: { lastMessageAt: 'DESC', createdAt: 'DESC' },
        select: { id: true, customerId: true, status: true, assignedMemberId: true },
      }),
    ]);

    const tagsBy = new Map<string, TagDto[]>();
    for (const link of links) {
      const list = tagsBy.get(link.customerId) ?? [];
      list.push({ id: link.tag.id, name: link.tag.name, color: link.tag.color ?? null });
      tagsBy.set(link.customerId, list);
    }
    const ownerBy = new Map(owners.map((owner) => [owner.id, owner]));
    const openBy = new Map<string, Conversation>();
    for (const conversation of open) {
      if (!openBy.has(conversation.customerId)) openBy.set(conversation.customerId, conversation);
    }

    return customers.map((customer, index): CustomerRow => {
      const owner = customer.ownerMemberId ? ownerBy.get(customer.ownerMemberId) : undefined;
      const conversation = openBy.get(customer.id);

      return {
        id: customer.id,
        firstName: customer.firstName ?? null,
        lastName: customer.lastName ?? null,
        displayName: customer.displayName ?? null,
        email: customer.email ?? null,
        phoneNumber: customer.phoneNumber ?? null,
        avatarUrl: customer.avatarUrl ?? null,
        source: customer.source,
        pipelineStageId: customer.pipelineStageId ?? null,
        ownerMemberId: customer.ownerMemberId ?? null,
        lastInteractionAt: customer.lastInteractionAt ?? null,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
        owner: owner
          ? {
              memberId: owner.id,
              name:
                [owner.user?.firstName, owner.user?.lastName].filter(Boolean).join(' ') ||
                owner.user?.username ||
                '',
              avatarUrl: owner.user?.avatarUrl ?? null,
            }
          : null,
        stage: customer.pipelineStage
          ? {
              id: customer.pipelineStage.id,
              name: customer.pipelineStage.name,
              color: customer.pipelineStage.color ?? null,
            }
          : null,
        tags: tagsBy.get(customer.id) ?? [],
        conversationsCount: counts[index] ?? 0,
        openConversation: conversation
          ? {
              id: conversation.id,
              status: conversation.status,
              assignedMemberId: conversation.assignedMemberId ?? null,
            }
          : null,
      };
    });
  }
}
