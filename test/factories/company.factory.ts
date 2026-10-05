import { faker } from '@faker-js/faker';
import { Factory } from 'fishery';

import { Company } from '@modules/company/entities/company.entity';

import type { ManagerTransientParams } from './types';

type CompanyTransientParams = ManagerTransientParams;

export const CompanyFactory = Factory.define<Company, CompanyTransientParams>(
  ({ onCreate, sequence, transientParams }) => {
    onCreate(async (company) => {
      const manager = transientParams.manager;
      if (!manager) return company;

      return manager.getRepository(Company).save(company);
    });

    const company = new Company();
    company.name = `${faker.company.name()} ${sequence}`;
    company.email = `company-${sequence}-${faker.string.alphanumeric(6)}@example.com`;
    company.timezone = 'America/Lima';
    company.status = 'active';

    return company;
  },
);
