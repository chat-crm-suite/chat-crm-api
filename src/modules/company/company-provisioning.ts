// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { EntityManager } from 'typeorm';

import type { CompanyStatus } from '../../contracts/index';
import { DEFAULT_PIPELINE_STAGES } from '../customers/pipeline-stages.defaults';
import { PipelineStage } from '../customers/entities/pipeline-stage.entity';
import { CompanySettings } from './entities/company-settings.entity';
import { Company } from './entities/company.entity';

export type NewCompanyData = {
  name: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
  timezone?: string;
  status?: CompanyStatus;
};

/**
 * The one way a company is born, shared by the first-run setup and the
 * platform console: the tenant row, its 1:1 settings row with engine defaults
 * and the default sales pipeline. Runs on the caller's transaction manager.
 */
export async function createCompanyWithDefaults(
  manager: EntityManager,
  data: NewCompanyData,
): Promise<Company> {
  const companies = manager.getRepository(Company);
  const settings = manager.getRepository(CompanySettings);
  const stages = manager.getRepository(PipelineStage);

  const company = await companies.save(
    companies.create({
      name: data.name,
      email: data.email,
      phoneNumber: data.phoneNumber,
      address: data.address,
      ...(data.timezone ? { timezone: data.timezone } : {}),
      ...(data.status ? { status: data.status } : {}),
    }),
  );

  await settings.save(settings.create({ companyId: company.id }));
  await stages.save(
    DEFAULT_PIPELINE_STAGES.map((stage) =>
      stages.create({ ...stage, companyId: company.id }),
    ),
  );

  return company;
}
