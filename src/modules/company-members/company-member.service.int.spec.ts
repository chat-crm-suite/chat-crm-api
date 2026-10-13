// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ClsService } from 'nestjs-cls';
import { DataSource, DataSourceOptions, EntityTarget } from 'typeorm';

import type { MemberRole, MemberStatus } from '@contracts';
import * as Entities from '@entities';
import {
  getTestConfig,
  truncateAllTables,
} from '@helpers/test-database.helper';
import { Company } from '../company/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { CompanyMemberService } from './company-member.service';
import { CompanyMember } from './entities/company-member.entity';

const entities = Object.values(Entities) as EntityTarget<unknown>[];

jest.setTimeout(180_000);

/**
 * Token claims seam: the access token only lists memberships that can act
 * right now (active member of a live company), in a stable order.
 */
describe('CompanyMemberService.findActiveClaims (integration)', () => {
  let dataSource: DataSource;
  let service: CompanyMemberService;
  let seq = 0;

  beforeAll(async () => {
    dataSource = new DataSource(getTestConfig(entities) as DataSourceOptions);
    await dataSource.initialize();
    service = new CompanyMemberService(
      dataSource.getRepository(CompanyMember),
      { get: jest.fn() } as unknown as ClsService,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    seq = 0;
  });

  const seedCompany = () => {
    const companies = dataSource.getRepository(Company);
    return companies.save(companies.create({ name: `company-${++seq}` }));
  };

  const seedUser = () => {
    const users = dataSource.getRepository(User);
    return users.save(
      users.create({
        username: `user-${++seq}`,
        passwordHash: '$2b$04$le0E9pls3D0fXBhXbv3aS.ejZsbJdrtuJIxiO0ov95jwoBVgaknaS',
      }),
    );
  };

  const seedMember = (
    user: User,
    company: Company,
    role: MemberRole,
    status: MemberStatus = 'active',
  ) => {
    const members = dataSource.getRepository(CompanyMember);
    return members.save(
      members.create({ userId: user.id, companyId: company.id, role, status }),
    );
  };

  it('lists every active membership with its member id and role', async () => {
    const user = await seedUser();
    const x = await seedCompany();
    const y = await seedCompany();
    const admin = await seedMember(user, x, 'admin');
    const agent = await seedMember(user, y, 'agent');

    const claims = await service.findActiveClaims(user.id);

    expect(claims).toHaveLength(2);
    expect(claims).toEqual(
      expect.arrayContaining([
        { cid: x.id, mid: admin.id, role: 'admin' },
        { cid: y.id, mid: agent.id, role: 'agent' },
      ]),
    );
  });

  it('leaves out inactive or suspended memberships', async () => {
    const user = await seedUser();
    const live = await seedCompany();
    const member = await seedMember(user, live, 'agent');
    await seedMember(user, await seedCompany(), 'admin', 'inactive');
    await seedMember(user, await seedCompany(), 'supervisor', 'suspended');

    await expect(service.findActiveClaims(user.id)).resolves.toEqual([
      { cid: live.id, mid: member.id, role: 'agent' },
    ]);
  });

  it('leaves out memberships of a soft-deleted company', async () => {
    const user = await seedUser();
    const live = await seedCompany();
    const deleted = await seedCompany();
    const member = await seedMember(user, live, 'agent');
    await seedMember(user, deleted, 'admin');
    await dataSource.getRepository(Company).softDelete({ id: deleted.id });

    await expect(service.findActiveClaims(user.id)).resolves.toEqual([
      { cid: live.id, mid: member.id, role: 'agent' },
    ]);
  });

  it('never returns another user memberships', async () => {
    const user = await seedUser();
    const other = await seedUser();
    await seedMember(other, await seedCompany(), 'admin');

    await expect(service.findActiveClaims(user.id)).resolves.toEqual([]);
  });
});
