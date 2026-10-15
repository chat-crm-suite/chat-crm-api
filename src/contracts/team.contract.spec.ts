// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  BulkDeleteCustomersSchema,
  CreateMemberSchema,
  CustomerTableQuerySchema,
  NotificationPreferencesSchema,
  PlatformCompanyQuerySchema,
  PlatformCreateCompanySchema,
  TeamTableQuerySchema,
  TeamTableResponseSchema,
  UpdateProfileSchema,
} from './index';

describe('team / customer / platform contracts', () => {
  it('requires email and role to add a member', () => {
    expect(CreateMemberSchema.safeParse({ email: 'ana@acme.test' }).success).toBe(
      false,
    );
    expect(
      CreateMemberSchema.safeParse({ email: 'ana@acme.test', role: 'agent' })
        .success,
    ).toBe(true);
    expect(
      CreateMemberSchema.safeParse({
        email: 'ana@acme.test',
        role: 'owner',
      }).success,
    ).toBe(false);
  });

  it('rejects a username that is not lowercase kebab-case', () => {
    const base = { email: 'ana@acme.test', role: 'agent' } as const;

    expect(
      CreateMemberSchema.safeParse({ ...base, username: 'Ana Lopez' }).success,
    ).toBe(false);
    expect(
      CreateMemberSchema.safeParse({ ...base, username: 'ana-lopez' }).success,
    ).toBe(true);
  });

  it('defaults table queries to page 1 with no sort', () => {
    expect(TeamTableQuerySchema.parse({})).toEqual({
      page: 1,
      perPage: 10,
      sort: [],
    });
    expect(CustomerTableQuerySchema.parse({ q: ' ana ' }).q).toBe('ana');
    expect(PlatformCompanyQuerySchema.parse({}).includeDeleted).toBe(false);
  });

  it('caps the page size so a table never loads unbounded rows', () => {
    expect(TeamTableQuerySchema.safeParse({ perPage: 101 }).success).toBe(
      false,
    );
  });

  it('accepts an empty-company team payload with zeroed counts', () => {
    const empty = {
      items: [],
      meta: {
        totalItems: 0,
        itemCount: 0,
        itemsPerPage: 10,
        totalPages: 0,
        currentPage: 1,
        counts: {
          byRole: { admin: 0, supervisor: 0, agent: 0 },
          byPresence: { available: 0, away: 0, offline: 0 },
        },
      },
    };

    expect(TeamTableResponseSchema.safeParse(empty).success).toBe(true);
  });

  it('bounds bulk deletes to 100 customers', () => {
    const id = '0190f5a0-0000-7000-8000-000000000000';

    expect(BulkDeleteCustomersSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(
      BulkDeleteCustomersSchema.safeParse({ ids: Array(101).fill(id) }).success,
    ).toBe(false);
    expect(BulkDeleteCustomersSchema.safeParse({ ids: [id] }).success).toBe(
      true,
    );
  });

  it('defaults notification preferences to nothing muted', () => {
    expect(NotificationPreferencesSchema.parse({})).toEqual({ muted: [] });
    expect(
      NotificationPreferencesSchema.safeParse({ muted: ['bogus'] }).success,
    ).toBe(false);
  });

  it('does not let a profile update change the username', () => {
    const parsed = UpdateProfileSchema.parse({
      firstName: 'Ana',
      username: 'hacker',
    });

    expect(parsed).toEqual({ firstName: 'Ana' });
  });

  it('lets the console create a company with or without a first admin', () => {
    expect(PlatformCreateCompanySchema.safeParse({ name: 'Acme' }).success).toBe(
      true,
    );
    expect(
      PlatformCreateCompanySchema.safeParse({
        name: 'Acme',
        admin: { email: 'boss@acme.test' },
      }).success,
    ).toBe(true);
    expect(PlatformCreateCompanySchema.safeParse({ name: ' ' }).success).toBe(
      false,
    );
  });
});
