// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { EntityManager, Repository } from 'typeorm';

import {
  CHANNEL_STATUS,
  CHANNEL_TYPE,
  DEFAULT_WHATSAPP_CHANNEL_NAME,
  DEFAULT_WHATSAPP_SETTINGS,
  type CompanyStatus,
} from '../../contracts/index';
import { Channel } from '../channels/entities/channel.entity';
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
 * The `pending` WhatsApp channel every company owns from birth: no account,
 * no credentials; the verify token comes from `ChannelSubscriber` on insert.
 * Shared by `createCompanyWithDefaults` and the backfill migration.
 */
export function pendingWhatsAppChannel(
  channels: Repository<Channel>,
  companyId: string,
): Channel {
  return channels.create({
    companyId,
    type: CHANNEL_TYPE.whatsapp,
    name: DEFAULT_WHATSAPP_CHANNEL_NAME,
    externalAccountId: null,
    credentials: null,
    settings: { ...DEFAULT_WHATSAPP_SETTINGS },
    status: CHANNEL_STATUS.pending,
  });
}

/**
 * The one way a company is born, shared by the first-run setup and the
 * platform console: the tenant row, its 1:1 settings row with engine defaults,
 * the default sales pipeline and a `pending` WhatsApp channel (its verify
 * token is generated on insert, so the webhook can be set up in Meta before
 * any credential exists). Runs on the caller's transaction manager.
 */
export async function createCompanyWithDefaults(
  manager: EntityManager,
  data: NewCompanyData,
): Promise<Company> {
  const companies = manager.getRepository(Company);
  const settings = manager.getRepository(CompanySettings);
  const stages = manager.getRepository(PipelineStage);
  const channels = manager.getRepository(Channel);

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
  await channels.save(pendingWhatsAppChannel(channels, company.id));

  return company;
}
