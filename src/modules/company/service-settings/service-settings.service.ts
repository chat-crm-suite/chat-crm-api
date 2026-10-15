// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  BusinessHoursSchema,
  DEFAULT_SLA_FIRST_RESPONSE_SECONDS,
  DEFAULT_SLA_TARGET_SHARE,
  type BusinessHours,
  type ServiceSettings,
  type UpdateServiceSettingsInput,
} from '@contracts';
import { defaultTimeZone, isValidTimeZone } from '@lib/zoned-time';
import { AnalyticsSignalEvent } from '../../analytics/events/analytics.events';
import { CompanySettings } from '../entities/company-settings.entity';
import { Company } from '../entities/company.entity';

/** Service settings plus the timezone every analytics bucket uses. */
export interface ResolvedServiceSettings extends ServiceSettings {
  timezone: string;
  /** `company_settings.auto_assign_max_open` (≤ 0 = no limit). */
  defaultCapacity: number | null;
}

/**
 * The company's business clock and SLA. Reads never write: a company without
 * a settings row gets the defaults (24/7, 5 min, 80 %), and stored hours that
 * no longer validate degrade to 24/7 instead of breaking every metric.
 */
@Injectable()
export class ServiceSettingsService {
  constructor(
    @InjectRepository(CompanySettings)
    private readonly settings: Repository<CompanySettings>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @Optional() private readonly eventBus?: EventBus,
  ) {}

  async get(companyId: string): Promise<ResolvedServiceSettings> {
    const [row, company] = await Promise.all([
      this.settings.findOne({ where: { companyId } }),
      this.companies.findOne({ where: { id: companyId }, select: { id: true, timezone: true } }),
    ]);
    return resolve(row, company?.timezone);
  }

  async update(
    companyId: string,
    input: UpdateServiceSettingsInput,
  ): Promise<ServiceSettings> {
    if (input.businessHours && !isValidTimeZone(input.businessHours.timezone)) {
      throw new BadRequestException('Unknown timezone');
    }
    if (input.businessHours) {
      const weekdays = input.businessHours.days.map((day) => day.weekday);
      if (new Set(weekdays).size !== weekdays.length) {
        throw new BadRequestException('Each weekday can appear only once');
      }
    }

    const row =
      (await this.settings.findOne({ where: { companyId } })) ??
      this.settings.create({ companyId });

    if (input.businessHours !== undefined) {
      row.businessHours = input.businessHours;
    }
    if (input.slaFirstResponseSeconds !== undefined) {
      row.slaFirstResponseSeconds = input.slaFirstResponseSeconds;
    }
    if (input.slaTargetShare !== undefined) {
      row.slaTargetShare = input.slaTargetShare;
    }
    await this.settings.save(row);

    // Every duration and SLA state is measured against these settings.
    this.eventBus?.publish(
      new AnalyticsSignalEvent(companyId, ['live', 'cases', 'presence']),
    );

    return toPublicSettings(resolve(row));
  }
}

/** The contract shape (drops the derived timezone and capacity). */
export function toPublicSettings(settings: ResolvedServiceSettings): ServiceSettings {
  return {
    businessHours: settings.businessHours,
    slaFirstResponseSeconds: settings.slaFirstResponseSeconds,
    slaTargetShare: settings.slaTargetShare,
  };
}

/**
 * The clock: the business-hours zone when configured, else the company's own
 * timezone, else the server default (`APP_TZ`).
 */
function resolve(row: CompanySettings | null, companyTimezone?: string): ResolvedServiceSettings {
  const parsed = BusinessHoursSchema.safeParse(row?.businessHours ?? undefined);
  const businessHours: BusinessHours | null =
    parsed.success && isValidTimeZone(parsed.data.timezone) ? parsed.data : null;
  const maxOpen = row?.autoAssignMaxOpen ?? null;

  return {
    businessHours,
    slaFirstResponseSeconds:
      row?.slaFirstResponseSeconds ?? DEFAULT_SLA_FIRST_RESPONSE_SECONDS,
    slaTargetShare: row?.slaTargetShare ?? DEFAULT_SLA_TARGET_SHARE,
    timezone:
      businessHours?.timezone ??
      (companyTimezone && isValidTimeZone(companyTimezone) ? companyTimezone : defaultTimeZone()),
    defaultCapacity: maxOpen !== null && maxOpen > 0 ? maxOpen : null,
  };
}
