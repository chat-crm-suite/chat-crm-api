// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Factory } from 'fishery';

import { CompanyMember } from '@modules/company-members/entities/company-member.entity';
import { Company } from '@modules/company/entities/company.entity';
import { User } from '@modules/users/entities/user.entity';

import { CompanyFactory } from './company.factory';
import type { ManagerTransientParams } from './types';
import { UserFactory } from './user.factory';

type CompanyMemberTransientParams = ManagerTransientParams;

export const CompanyMemberFactory = Factory.define<
  CompanyMember,
  CompanyMemberTransientParams
>(({ associations, onCreate, params, transientParams }) => {
  onCreate(async (member) => {
    const manager = transientParams.manager;
    if (!manager) return member;

    if (member.user && !member.user.id) {
      member.user = await UserFactory.transient({ manager }).create(member.user);
    }
    if (member.user?.id) member.userId = member.user.id;

    if (member.company && !member.company.id) {
      member.company = await CompanyFactory.transient({ manager }).create(
        member.company,
      );
    }
    if (member.company?.id) member.companyId = member.company.id;

    return manager.getRepository(CompanyMember).save(member);
  });

  const member = new CompanyMember();
  member.role = params.role ?? 'agent';
  member.status = params.status ?? 'active';
  member.acceptsAutoAssign = params.acceptsAutoAssign ?? true;
  member.maxOpenConversations = params.maxOpenConversations;

  const user =
    associations.user ??
    (params.userId ? ({ id: params.userId } as User) : UserFactory.build());
  member.user = user;
  member.userId = user.id;

  const company =
    associations.company ??
    (params.companyId
      ? ({ id: params.companyId } as Company)
      : CompanyFactory.build());
  member.company = company;
  member.companyId = company.id;

  return member;
});
