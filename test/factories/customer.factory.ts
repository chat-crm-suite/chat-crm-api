// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { faker } from '@faker-js/faker';
import { Factory } from 'fishery';

import { Company } from '@modules/company/entities/company.entity';
import { Customer } from '@modules/customers/entities/customer.entity';

import { CompanyFactory } from './company.factory';
import { CompanyMemberFactory } from './company-member.factory';
import type { ManagerTransientParams } from './types';

type CustomerTransientParams = ManagerTransientParams;

export const CustomerFactory = Factory.define<Customer, CustomerTransientParams>(
  ({ associations, onCreate, params, sequence, transientParams }) => {
    onCreate(async (customer) => {
      const manager = transientParams.manager;
      if (!manager) return customer;

      if (customer.company && !customer.company.id) {
        customer.company = await CompanyFactory.transient({ manager }).create(
          customer.company,
        );
      }
      if (customer.company?.id) customer.companyId = customer.company.id;

      if (customer.ownerMember && !customer.ownerMember.id) {
        customer.ownerMember = await CompanyMemberFactory.transient({
          manager,
        }).create(customer.ownerMember);
      }
      if (customer.ownerMember?.id) {
        customer.ownerMemberId = customer.ownerMember.id;
      }

      return manager.getRepository(Customer).save(customer);
    });

    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();

    const customer = new Customer();
    customer.firstName = firstName;
    customer.lastName = lastName;
    customer.displayName = `${firstName} ${lastName}`;
    customer.email = `customer-${sequence}-${faker.string.alphanumeric(6)}@example.com`;
    customer.phoneNumber = `+519${String(sequence).padStart(8, '0')}`;
    customer.avatarUrl = faker.image.avatar();
    customer.source = params.source ?? 'whatsapp';
    customer.lastInteractionAt =
      params.lastInteractionAt ?? faker.date.recent({ days: 15 });

    const company =
      associations.company ??
      (params.companyId
        ? ({ id: params.companyId } as Company)
        : CompanyFactory.build());
    customer.company = company;
    customer.companyId = company.id;

    if (associations.pipelineStage) {
      customer.pipelineStage = associations.pipelineStage;
      customer.pipelineStageId = associations.pipelineStage.id;
    }
    if (params.pipelineStageId) customer.pipelineStageId = params.pipelineStageId;

    if (associations.ownerMember) {
      customer.ownerMember = associations.ownerMember;
      customer.ownerMemberId = associations.ownerMember.id;
    }
    if (params.ownerMemberId) customer.ownerMemberId = params.ownerMemberId;

    return customer;
  },
);
