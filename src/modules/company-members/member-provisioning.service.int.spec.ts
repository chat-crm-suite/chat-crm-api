// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DataSource, DataSourceOptions } from 'typeorm';

import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from '../../../test/helpers/test-database.helper';
import { Company } from '../company/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { CompanyMember } from './entities/company-member.entity';
import { MemberProvisioningService } from './member-provisioning.service';

jest.setTimeout(60_000);

/**
 * The shared "add a person to a company" rule (team screen + platform
 * console), on in-memory SQLite.
 */
describe('MemberProvisioningService (integration)', () => {
  let dataSource: DataSource;
  const service = new MemberProvisioningService();
  let company: Company;

  const run = <T>(work: Parameters<DataSource['transaction']>[0]) =>
    dataSource.transaction(work as never) as Promise<T>;

  const provision = (input: Partial<Parameters<MemberProvisioningService['provision']>[1]> = {}) =>
    dataSource.transaction((manager) =>
      service.provision(manager, {
        companyId: company.id,
        email: 'ana.lopez@acme.test',
        role: 'agent',
        ...input,
      }),
    );

  beforeAll(async () => {
    dataSource = new DataSource(
      getTestSQLiteConfig(getSQLiteEntities()) as DataSourceOptions,
    );
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    const companies = dataSource.getRepository(Company);
    company = await companies.save(companies.create({ name: 'Acme' }));
  });

  it('creates the account and the member with a generated password', async () => {
    const result = await provision({ firstName: 'Ana' });

    expect(result.outcome).toBe('created');
    expect(result.user.username).toBe('ana-lopez');
    expect(result.initialPassword).toHaveLength(14);
    expect(
      await bcrypt.compare(result.initialPassword!, result.user.passwordHash),
    ).toBe(true);
    expect(result.member).toMatchObject({
      companyId: company.id,
      role: 'agent',
      status: 'active',
    });
  });

  it('links an existing account by email without touching its password', async () => {
    const users = dataSource.getRepository(User);
    const existing = await users.save(
      users.create({
        email: 'ana.lopez@acme.test',
        username: 'ana',
        passwordHash: 'keep-me',
      }),
    );

    const result = await provision({ email: 'ANA.Lopez@acme.test' });

    expect(result.outcome).toBe('linked');
    expect(result.initialPassword).toBeUndefined();
    expect(result.member.userId).toBe(existing.id);
    expect((await users.findOneByOrFail({ id: existing.id })).passwordHash).toBe(
      'keep-me',
    );
  });

  it('derives a free username when the email prefix is taken', async () => {
    await provision({ email: 'ana@one.test' });
    const second = await provision({ email: 'ana@two.test' });

    expect(second.user.username).toBe('ana-2');
  });

  it('rejects an explicit username that is already taken', async () => {
    await provision({ email: 'ana@one.test', username: 'ana' });

    await expect(
      provision({ email: 'bea@one.test', username: 'ana' }),
    ).rejects.toMatchObject({ response: { code: 'username_taken' } });
  });

  it('refuses to add the same active member twice', async () => {
    await provision();

    await expect(provision()).rejects.toBeInstanceOf(ConflictException);
  });

  it('restores a soft-deleted membership with the new role', async () => {
    const first = await provision({ role: 'agent' });
    await dataSource.getRepository(CompanyMember).softDelete(first.member.id);

    const again = await provision({ role: 'supervisor' });

    expect(again.outcome).toBe('restored');
    expect(again.member.id).toBe(first.member.id);
    expect(again.member).toMatchObject({ role: 'supervisor', status: 'active' });
    expect(again.member.deletedAt).toBeNull();
    expect(await dataSource.getRepository(CompanyMember).count()).toBe(1);
  });

  it('does not add a disabled (soft-deleted) account', async () => {
    const first = await provision();
    await dataSource.getRepository(User).softDelete(first.user.id);

    await expect(provision()).rejects.toMatchObject({
      response: { code: 'account_disabled' },
    });
  });

  it('rolls back the account when the membership step fails', async () => {
    await expect(
      run(async (manager) => {
        await service.provision(manager, {
          companyId: company.id,
          email: 'ana@acme.test',
          role: 'agent',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await dataSource.getRepository(User).count()).toBe(0);
  });
});
