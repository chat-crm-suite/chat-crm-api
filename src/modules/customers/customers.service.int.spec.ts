// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ClsService } from 'nestjs-cls';
import { DataSource, DataSourceOptions } from 'typeorm';

import { MemoryRedis } from '@helpers/memory-redis';
import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from '@helpers/test-database.helper';
import { WorkspaceTableCache } from '../../common/cache/workspace-table-cache.service';
import { WorkspaceChangedEvent } from '../../common/events/workspace-changed.event';
import { CLS_COMPANY_ID } from '../../config/cls.keys';
import {
  CustomerMutationResultSchema,
  CustomerRowSchema,
  CustomerTableQuerySchema,
  NO_OWNER_FILTER,
  paginatedSchema,
  PipelineStageSchema,
  WorkspaceSocketEvent,
  type CustomerTableQuery,
} from '../../contracts/index';
import { Channel } from '../channels/entities/channel.entity';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { Company } from '../company/entities/company.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { User } from '../users/entities/user.entity';
import { CustomersService } from './customers.service';
import { CustomerIdentity } from './entities/customer-identity.entity';
import { CustomerTag } from './entities/customer-tag.entity';
import { Customer } from './entities/customer.entity';
import { PipelineStage } from './entities/pipeline-stage.entity';
import { Tag } from './entities/tag.entity';

jest.setTimeout(120_000);

const logger = { setContext: jest.fn(), warn: jest.fn() };

/**
 * Customers on in-memory SQLite: tenant isolation, restore-on-create/import/
 * inbound, the rich table, tags, stages and the cache.
 */
describe('CustomersService (integration)', () => {
  let dataSource: DataSource;
  let service: CustomersService;
  let csvRows: { displayName?: string; phoneNumber?: string; email?: string }[];
  const redis = new MemoryRedis();
  const eventBus = { publish: jest.fn() };
  const context = new Map<string, unknown>();
  const cls = { get: (key: string) => context.get(key) } as unknown as ClsService;
  let seq = 0;

  beforeAll(async () => {
    dataSource = new DataSource(
      getTestSQLiteConfig(getSQLiteEntities()) as DataSourceOptions,
    );
    await dataSource.initialize();
    const csv = { parse: () => Promise.resolve({ list: csvRows }) };
    service = new CustomersService(
      dataSource.getRepository(Customer),
      dataSource.getRepository(CustomerIdentity),
      csv as never,
      cls,
      new WorkspaceTableCache(redis as never, logger as never, eventBus as never),
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    redis.store.clear();
    redis.failing = false;
    eventBus.publish.mockClear();
    context.clear();
    csvRows = [];
    seq = 0;
  });

  const save = <T extends object>(entity: new () => T, data: Partial<T>) => {
    const repo = dataSource.getRepository(entity);
    return repo.save(repo.create(data as T));
  };

  const seedCompany = async () => {
    const company = await save(Company, { name: `company-${++seq}` });
    return company;
  };
  const actIn = (company: Company) => context.set(CLS_COMPANY_ID, company.id);

  const seedCustomer = (company: Company, extra: Partial<Customer> = {}) =>
    save(Customer, {
      companyId: company.id,
      displayName: `Cliente ${++seq}`,
      phoneNumber: `+5190000${String(++seq).padStart(4, '0')}`,
      ...extra,
    });

  const seedMember = async (company: Company, username = `user-${++seq}`) => {
    const user = await save(User, { username, firstName: 'Ana', lastName: 'Soto', passwordHash: 'x' });
    return save(CompanyMember, { userId: user.id, companyId: company.id, role: 'agent', status: 'active' });
  };

  const query = (extra: Partial<CustomerTableQuery> = {}) => CustomerTableQuerySchema.parse(extra);
  const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);

  const seedConversation = async (
    company: Company,
    customer: Customer,
    status: Conversation['status'],
    assignedMemberId: string | null = null,
  ) => {
    const channels = dataSource.getRepository(Channel);
    const channel =
      (await channels.findOne({ where: { companyId: company.id } })) ??
      (await save(Channel, {
        companyId: company.id,
        type: 'whatsapp',
        name: 'main',
        externalAccountId: `acc-${++seq}`,
        credentials: '{}',
      }));
    return save(Conversation, {
      companyId: company.id,
      customerId: customer.id,
      channelId: channel.id,
      status,
      assignedMemberId,
    });
  };

  // ---------------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('never reads or writes another company, answering 404 for foreign ids', async () => {
      const mine = await seedCompany();
      const theirs = await seedCompany();
      const own = await seedCustomer(mine, { displayName: 'Mia', phoneNumber: '+51911111111' });
      const foreign = await seedCustomer(theirs, { displayName: 'Mia', phoneNumber: '+51922222222' });
      actIn(mine);

      expect(ids(await service.table(query()))).toEqual([own.id]);
      expect((await service.search('Mia')).map((customer) => customer.id)).toEqual([own.id]);
      expect((await service.findAll()).map((customer) => customer.id)).toEqual([own.id]);
      expect(await service.findByPhone('+51922222222')).toBeNull();
      expect((await service.findByPhone('51911111111'))?.id).toBe(own.id);

      await expect(service.update(foreign.id, { displayName: 'Hacked' })).rejects.toMatchObject({
        status: 404,
      });
      await expect(service.remove(foreign.id)).rejects.toMatchObject({ status: 404 });
      await expect(service.setTags(foreign.id, { tagIds: [] })).rejects.toMatchObject({ status: 404 });
      await expect(service.bulkDelete([foreign.id])).resolves.toEqual({ deleted: 0 });

      const untouched = await dataSource.getRepository(Customer).findOneByOrFail({ id: foreign.id });
      expect(untouched.displayName).toBe('Mia');
      expect(untouched.deletedAt).toBeNull();
    });

    it('rejects stages, owners and tags that belong to another company', async () => {
      const mine = await seedCompany();
      const theirs = await seedCompany();
      const stage = await save(PipelineStage, { companyId: theirs.id, name: 'Lead', position: 1 });
      const owner = await seedMember(theirs);
      const tag = await save(Tag, { companyId: theirs.id, name: 'vip' });
      const customer = await seedCustomer(mine);
      actIn(mine);

      await expect(service.create({ displayName: 'X', pipelineStageId: stage.id })).rejects.toMatchObject({
        response: { code: 'unknown_stage' },
      });
      await expect(service.update(customer.id, { ownerMemberId: owner.id })).rejects.toMatchObject({
        response: { code: 'unknown_owner' },
      });
      await expect(service.setTags(customer.id, { tagIds: [tag.id] })).rejects.toMatchObject({
        response: { code: 'unknown_tag' },
      });
    });

    it('requires a company context', async () => {
      await expect(service.table(query())).rejects.toMatchObject({ status: 400 });
    });
  });

  // ---------------------------------------------------------------------------
  // Create / update / restore
  // ---------------------------------------------------------------------------

  describe('create', () => {
    it('creates with a normalized phone and a parseable result', async () => {
      const company = await seedCompany();
      actIn(company);

      const result = await service.create({ displayName: 'Ana', phoneNumber: '51 999-111-222' });

      expect(() => CustomerMutationResultSchema.parse(result)).not.toThrow();
      expect(result.restored).toBe(false);
      expect(result.customer).toMatchObject({
        phoneNumber: '+51999111222',
        source: 'manual',
        tags: [],
        conversationsCount: 0,
        openConversation: null,
        owner: null,
        stage: null,
      });
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ event: WorkspaceSocketEvent.CustomersChanged }),
      );
    });

    it('answers 409 with the existing id when an active customer has the phone', async () => {
      const company = await seedCompany();
      const existing = await seedCustomer(company, { phoneNumber: '+51999111222' });
      actIn(company);

      await expect(service.create({ phoneNumber: '51999111222' })).rejects.toMatchObject({
        status: 409,
        response: { code: 'customer_exists', customerId: existing.id },
      });
      // The same phone in another company is another person.
      const other = await seedCompany();
      actIn(other);
      await expect(service.create({ phoneNumber: '+51999111222' })).resolves.toMatchObject({
        restored: false,
      });
    });

    it('restores a soft-deleted customer and applies the payload', async () => {
      const company = await seedCompany();
      const old = await seedCustomer(company, {
        phoneNumber: '+51999111222',
        displayName: 'Old name',
        email: 'keep@acme.test',
      });
      await dataSource.getRepository(Customer).softDelete(old.id);
      actIn(company);

      const result = await service.create({ phoneNumber: '+51999111222', displayName: 'New name' });

      expect(result.restored).toBe(true);
      expect(result.customer).toMatchObject({
        id: old.id,
        displayName: 'New name',
        email: 'keep@acme.test',
      });
      expect(ids(await service.table(query()))).toEqual([old.id]);
    });

    it('rejects a phone without digits', async () => {
      const company = await seedCompany();
      actIn(company);

      await expect(service.create({ phoneNumber: 'abc' })).rejects.toMatchObject({
        response: { code: 'invalid_phone' },
      });
    });
  });

  describe('update', () => {
    it('edits fields and refuses a phone held by an active customer', async () => {
      const company = await seedCompany();
      const a = await seedCustomer(company, { phoneNumber: '+51911111111' });
      const b = await seedCustomer(company, { phoneNumber: '+51922222222' });
      actIn(company);

      const result = await service.update(a.id, { displayName: 'Renamed' });
      expect(result).toMatchObject({ restored: false, customer: { displayName: 'Renamed' } });

      await expect(service.update(a.id, { phoneNumber: '+51922222222' })).rejects.toMatchObject({
        status: 409,
        response: { customerId: b.id },
      });
    });

    it('clears the owner and the stage when they are sent as null', async () => {
      const company = await seedCompany();
      const stage = await save(PipelineStage, { companyId: company.id, name: 'Lead', position: 1 });
      const owner = await seedMember(company);
      const customer = await seedCustomer(company, {
        pipelineStageId: stage.id,
        ownerMemberId: owner.id,
      });
      actIn(company);

      const result = await service.update(customer.id, {
        ownerMemberId: null,
        pipelineStageId: null,
      });

      expect(result.customer).toMatchObject({ owner: null, stage: null });
      expect(result.customer.ownerMemberId ?? null).toBeNull();
      expect(result.customer.pipelineStageId ?? null).toBeNull();
    });

    it('takes over a phone held by a soft-deleted customer', async () => {
      const company = await seedCompany();
      const a = await seedCustomer(company, { phoneNumber: '+51911111111' });
      const gone = await seedCustomer(company, { phoneNumber: '+51922222222' });
      await dataSource.getRepository(Customer).softDelete(gone.id);
      actIn(company);

      const result = await service.update(a.id, { phoneNumber: '51922222222' });

      expect(result.customer.phoneNumber).toBe('+51922222222');
      const released = await dataSource
        .getRepository(Customer)
        .findOne({ where: { id: gone.id }, withDeleted: true });
      expect(released?.phoneNumber).toBeNull();
    });
  });

  describe('findRow', () => {
    it('returns the table row of an own customer and 404 for foreign or deleted ones', async () => {
      const mine = await seedCompany();
      const theirs = await seedCompany();
      const owner = await seedMember(mine);
      const own = await seedCustomer(mine, { displayName: 'Mia', ownerMemberId: owner.id });
      const foreign = await seedCustomer(theirs, { displayName: 'Otra' });
      const gone = await seedCustomer(mine, { displayName: 'Borrada', phoneNumber: '+51933333333' });
      await dataSource.getRepository(Customer).softDelete(gone.id);
      actIn(mine);

      expect(await service.findRow(own.id)).toMatchObject({
        id: own.id,
        displayName: 'Mia',
        owner: { memberId: owner.id },
        tags: [],
        conversationsCount: 0,
        openConversation: null,
      });
      await expect(service.findRow(foreign.id)).rejects.toMatchObject({ status: 404 });
      await expect(service.findRow(gone.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('remove and bulk delete', () => {
    it('soft deletes inside the company only', async () => {
      const mine = await seedCompany();
      const theirs = await seedCompany();
      const a = await seedCustomer(mine);
      const b = await seedCustomer(mine);
      const foreign = await seedCustomer(theirs);
      actIn(mine);

      await expect(service.remove(a.id)).resolves.toEqual({ deleted: 1 });
      await expect(service.remove(a.id)).rejects.toMatchObject({ status: 404 });
      await expect(service.bulkDelete([b.id, foreign.id, a.id])).resolves.toEqual({ deleted: 1 });

      expect(await dataSource.getRepository(Customer).count()).toBe(1);
      expect((await dataSource.getRepository(Customer).findOneByOrFail({ id: foreign.id })).deletedAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  describe('importCsv', () => {
    it('creates, restores and skips, counting each', async () => {
      const company = await seedCompany();
      await seedCustomer(company, { phoneNumber: '+51911111111' });
      const gone = await seedCustomer(company, { phoneNumber: '+51922222222', displayName: 'Old' });
      await dataSource.getRepository(Customer).softDelete(gone.id);
      actIn(company);
      csvRows = [
        { displayName: 'New', phoneNumber: '51933333333' },
        { displayName: 'Active duplicate', phoneNumber: '+51 911 111 111' },
        { displayName: 'Back', phoneNumber: '51922222222' },
        { displayName: 'Repeated in file', phoneNumber: '51933333333' },
        { displayName: 'No phone' },
      ];

      const result = await service.importCsv({ buffer: Buffer.from('x') } as Express.Multer.File);

      expect(result).toEqual({ created: 2, restored: 1, skipped: 2 });
      const all = await dataSource.getRepository(Customer).find();
      expect(all).toHaveLength(4);
      expect(all.find((customer) => customer.id === gone.id)?.displayName).toBe('Back');
      expect(all.find((customer) => customer.displayName === 'New')?.source).toBe('import');
      expect(all.some((customer) => customer.displayName === 'No phone')).toBe(true);
      expect(all.some((customer) => customer.displayName === 'Active duplicate')).toBe(false);
    });

    it('requires a file', async () => {
      const company = await seedCompany();
      actIn(company);

      await expect(service.importCsv(undefined as never)).rejects.toMatchObject({ status: 400 });
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound
  // ---------------------------------------------------------------------------

  describe('findOrCreateIncoming', () => {
    const inbound = (company: Company, channel: Channel, extra: Record<string, string> = {}) =>
      service.findOrCreateIncoming({
        companyId: company.id,
        channelId: channel.id,
        externalId: '51999111222',
        phoneNumber: '51999111222',
        profileName: 'Ana',
        ...extra,
      });

    const seedChannel = (company: Company) =>
      save(Channel, {
        companyId: company.id,
        type: 'whatsapp',
        name: 'main',
        externalAccountId: `acc-${++seq}`,
        credentials: '{}',
      });

    it('creates the customer and its identity, announcing the change', async () => {
      const company = await seedCompany();
      const channel = await seedChannel(company);

      const customer = await inbound(company, channel);

      expect(customer).toMatchObject({ phoneNumber: '+51999111222', source: 'whatsapp', displayName: 'Ana' });
      expect(customer.lastInteractionAt).toBeInstanceOf(Date);
      expect(await dataSource.getRepository(CustomerIdentity).count()).toBe(1);
      expect(
        eventBus.publish.mock.calls.some(
          ([event]: [unknown]) =>
            event instanceof WorkspaceChangedEvent && event.event === WorkspaceSocketEvent.CustomersChanged,
        ),
      ).toBe(true);

      // Same sender again: same customer, no new row.
      expect((await inbound(company, channel)).id).toBe(customer.id);
      expect(await dataSource.getRepository(Customer).count()).toBe(1);
    });

    it('restores a deleted customer found through its identity', async () => {
      const company = await seedCompany();
      const channel = await seedChannel(company);
      const customer = await inbound(company, channel);
      await dataSource.getRepository(Customer).softDelete(customer.id);
      eventBus.publish.mockClear();

      const again = await inbound(company, channel);

      expect(again.id).toBe(customer.id);
      expect(again.deletedAt).toBeNull();
      expect(await dataSource.getRepository(Customer).count()).toBe(1);
      expect(eventBus.publish).toHaveBeenCalled();
    });

    it('restores a deleted customer found through its phone and links the identity', async () => {
      const company = await seedCompany();
      const channel = await seedChannel(company);
      const old = await seedCustomer(company, { phoneNumber: '+51999111222' });
      await dataSource.getRepository(Customer).softDelete(old.id);

      const customer = await inbound(company, channel);

      expect(customer.id).toBe(old.id);
      expect(customer.deletedAt).toBeNull();
      const identity = await dataSource.getRepository(CustomerIdentity).findOneByOrFail({ customerId: old.id });
      expect(identity.externalId).toBe('51999111222');
      actIn(company);
      expect(ids(await service.table(query()))).toEqual([old.id]);
    });
  });

  // ---------------------------------------------------------------------------
  // Table
  // ---------------------------------------------------------------------------

  describe('table', () => {
    it('returns an empty page for an empty company', async () => {
      const company = await seedCompany();
      actIn(company);

      const page = await service.table(query());

      expect(page).toEqual({
        items: [],
        meta: { totalItems: 0, itemCount: 0, itemsPerPage: 10, totalPages: 0, currentPage: 1 },
      });
    });

    it('returns rows with owner, stage, tags and conversations', async () => {
      const company = await seedCompany();
      const stage = await save(PipelineStage, { companyId: company.id, name: 'Won', position: 3, color: '#00ff00' });
      const owner = await seedMember(company);
      const tag = await save(Tag, { companyId: company.id, name: 'vip', color: '#ff0000' });
      const customer = await seedCustomer(company, { pipelineStageId: stage.id, ownerMemberId: owner.id });
      await save(CustomerTag, { customerId: customer.id, tagId: tag.id });
      await seedConversation(company, customer, 'closed');
      await seedConversation(company, customer, 'open', owner.id);
      actIn(company);

      const page = await service.table(query());

      expect(() => paginatedSchema(CustomerRowSchema).parse(page)).not.toThrow();
      expect(page.items[0]).toMatchObject({
        id: customer.id,
        owner: { memberId: owner.id, name: 'Ana Soto' },
        stage: { id: stage.id, name: 'Won', color: '#00ff00' },
        tags: [{ id: tag.id, name: 'vip', color: '#ff0000' }],
        conversationsCount: 2,
        openConversation: { status: 'open', assignedMemberId: owner.id },
      });
    });

    it('keeps a removed owner as the historic owner', async () => {
      const company = await seedCompany();
      const owner = await seedMember(company);
      const customer = await seedCustomer(company, { ownerMemberId: owner.id });
      await dataSource.getRepository(CompanyMember).softDelete(owner.id);
      actIn(company);

      const page = await service.table(query());
      expect(page.items.find((item) => item.id === customer.id)?.owner?.name).toBe('Ana Soto');
    });

    it('filters by text, stage, owner (including none), tag, source and interaction range', async () => {
      const company = await seedCompany();
      const lead = await save(PipelineStage, { companyId: company.id, name: 'Lead', position: 1 });
      const won = await save(PipelineStage, { companyId: company.id, name: 'Won', position: 2 });
      const owner = await seedMember(company);
      const vip = await save(Tag, { companyId: company.id, name: 'vip' });
      const cold = await save(Tag, { companyId: company.id, name: 'cold' });

      const ana = await seedCustomer(company, {
        displayName: 'Ana Perez',
        phoneNumber: '+51999000111',
        email: 'ana@acme.test',
        pipelineStageId: lead.id,
        ownerMemberId: owner.id,
        source: 'whatsapp',
        lastInteractionAt: new Date('2026-01-10T00:00:00Z'),
      });
      const beto = await seedCustomer(company, {
        displayName: 'Beto Ruiz',
        phoneNumber: '+51888000222',
        pipelineStageId: won.id,
        source: 'import',
        lastInteractionAt: new Date('2026-03-10T00:00:00Z'),
      });
      const carla = await seedCustomer(company, { displayName: 'Carla', source: 'manual' });
      await save(CustomerTag, { customerId: ana.id, tagId: vip.id });
      await save(CustomerTag, { customerId: ana.id, tagId: cold.id });
      await save(CustomerTag, { customerId: beto.id, tagId: cold.id });
      actIn(company);

      const run = async (extra: Partial<CustomerTableQuery>) =>
        ids(await service.table(query(extra))).sort();

      expect(await run({ q: 'ana@acme' })).toEqual([ana.id]);
      expect(await run({ q: '888 000' })).toEqual([beto.id]);
      expect(await run({ q: 'Perez' })).toEqual([ana.id]);
      expect(await run({ stageId: [won.id] })).toEqual([beto.id]);
      expect(await run({ stageId: [lead.id, won.id] })).toEqual([ana.id, beto.id].sort());
      expect(await run({ ownerMemberId: [owner.id] })).toEqual([ana.id]);
      expect(await run({ ownerMemberId: [NO_OWNER_FILTER] })).toEqual([beto.id, carla.id].sort());
      expect(await run({ ownerMemberId: [NO_OWNER_FILTER, owner.id] })).toEqual(
        [ana.id, beto.id, carla.id].sort(),
      );
      expect(await run({ tagId: [vip.id] })).toEqual([ana.id]);
      expect(await run({ tagId: [cold.id] })).toEqual([ana.id, beto.id].sort());
      expect(await run({ tagId: [vip.id], source: ['import'] })).toEqual([]);
      expect(await run({ source: ['import', 'manual'] })).toEqual([beto.id, carla.id].sort());
      expect(await run({ lastInteractionFrom: '2026-02-01T00:00:00Z' })).toEqual([beto.id]);
      expect(await run({ lastInteractionTo: '2026-02-01T00:00:00Z' })).toEqual([ana.id]);

      const page = await service.table(query({ tagId: [cold.id] }));
      expect(page.meta.totalItems).toBe(2);
    });

    it('sorts by last interaction (nulls last) by default and by whitelisted columns', async () => {
      const company = await seedCompany();
      const older = await seedCustomer(company, {
        displayName: 'B',
        lastInteractionAt: new Date('2026-01-01T00:00:00Z'),
      });
      const newer = await seedCustomer(company, {
        displayName: 'C',
        lastInteractionAt: new Date('2026-02-01T00:00:00Z'),
      });
      const never = await seedCustomer(company, { displayName: 'A' });
      actIn(company);

      expect(ids(await service.table(query()))).toEqual([newer.id, older.id, never.id]);
      expect(ids(await service.table(query({ sort: [{ id: 'displayName', desc: false }] })))).toEqual([
        never.id,
        older.id,
        newer.id,
      ]);
      expect(ids(await service.table(query({ sort: [{ id: 'nope; DROP TABLE x', desc: true }] })))).toHaveLength(3);
      await seedConversation(company, older, 'closed');
      await seedConversation(company, older, 'open');
      expect(
        ids(await service.table(query({ sort: [{ id: 'conversationsCount', desc: true }] })))[0],
      ).toBe(older.id);

      const second = await service.table(query({ perPage: 2, page: 2 }));
      expect(ids(second)).toEqual([never.id]);
      expect(second.meta).toMatchObject({ totalItems: 3, totalPages: 2, currentPage: 2 });
    });

    it('hides deleted customers and serves cached pages until a mutation', async () => {
      const company = await seedCompany();
      const a = await seedCustomer(company, { displayName: 'A' });
      const b = await seedCustomer(company, { displayName: 'B' });
      await dataSource.getRepository(Customer).softDelete(b.id);
      actIn(company);

      expect(ids(await service.table(query()))).toEqual([a.id]);

      // Behind the service's back: still cached.
      await dataSource.getRepository(Customer).update(a.id, { displayName: 'Changed' });
      expect((await service.table(query())).items[0].displayName).toBe('A');

      // A mutation bumps the version.
      await service.update(a.id, { email: 'a@acme.test' });
      expect((await service.table(query())).items[0]).toMatchObject({
        displayName: 'Changed',
        email: 'a@acme.test',
      });
    });

    it('works without Redis', async () => {
      const company = await seedCompany();
      await seedCustomer(company);
      actIn(company);
      redis.failing = true;

      expect((await service.table(query())).items).toHaveLength(1);
      await expect(service.create({ displayName: 'Still works' })).resolves.toMatchObject({
        restored: false,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Tags and stages
  // ---------------------------------------------------------------------------

  describe('tags', () => {
    it('creates tags, rejects duplicate names per company and lists them by name', async () => {
      const company = await seedCompany();
      const other = await seedCompany();
      actIn(company);

      const vip = await service.createTag({ name: 'vip', color: '#112233' });
      await service.createTag({ name: 'alpha' });
      await expect(service.createTag({ name: 'vip' })).rejects.toMatchObject({
        status: 409,
        response: { code: 'tag_exists', tagId: vip.id },
      });
      actIn(other);
      await expect(service.createTag({ name: 'vip' })).resolves.toMatchObject({ name: 'vip' });

      actIn(company);
      expect((await service.listTags()).map((tag) => tag.name)).toEqual(['alpha', 'vip']);
    });

    it('replaces the whole set of a customer', async () => {
      const company = await seedCompany();
      const customer = await seedCustomer(company);
      actIn(company);
      const a = await service.createTag({ name: 'a' });
      const b = await service.createTag({ name: 'b' });
      const c = await service.createTag({ name: 'c' });

      const first = await service.setTags(customer.id, { tagIds: [a.id, b.id, a.id] });
      expect(first.tags.map((tag) => tag.name)).toEqual(['a', 'b']);

      const second = await service.setTags(customer.id, { tagIds: [c.id] });
      expect(second.tags.map((tag) => tag.name)).toEqual(['c']);

      const cleared = await service.setTags(customer.id, { tagIds: [] });
      expect(cleared.tags).toEqual([]);
      expect(await dataSource.getRepository(CustomerTag).count()).toBe(0);
    });
  });

  describe('listStages', () => {
    it('lists the stages of the company ordered by position, never another one', async () => {
      const company = await seedCompany();
      const other = await seedCompany();
      await save(PipelineStage, { companyId: company.id, name: 'Won', position: 3, isWon: true });
      await save(PipelineStage, { companyId: company.id, name: 'Lead', position: 1, color: '#123456' });
      await save(PipelineStage, { companyId: company.id, name: 'Talking', position: 2 });
      await save(PipelineStage, { companyId: other.id, name: 'Foreign', position: 0 });
      actIn(company);

      const stages = await service.listStages();

      expect(stages.map((stage) => stage.name)).toEqual(['Lead', 'Talking', 'Won']);
      expect(() => PipelineStageSchema.array().parse(stages)).not.toThrow();
    });

    it('is an empty list, not an error, for a company without stages', async () => {
      const company = await seedCompany();
      actIn(company);

      await expect(service.listStages()).resolves.toEqual([]);
    });
  });
});
