// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, Optional } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, IsNull, Repository } from 'typeorm';

import {
  BUDGET_WARNING_SHARE,
  type BudgetThreshold,
  type ChannelRate as ChannelRateDto,
  type ChannelType,
  NotificationTypeSchema,
  type SpendSummary,
} from '../../contracts/index';
import { isDuplicateKeyError } from '../../lib/helpers/query-error.helper';
import { round, runRateProjection, sufficiency } from '../../lib/stats/index';
import {
  zonedDateKey,
  zonedDateKeys,
  zonedMonthBounds,
  zonedMonthKey,
} from '../../lib/zoned-time';
import {
  AnalyticsSignalEvent,
  RealtimeNotificationEvent,
} from '../analytics/events/analytics.events';
import { Case } from '../cases/entities/case.entity';
import { Channel } from '../channels/entities/channel.entity';
import { ChannelPricingRegistry } from '../channels/ports/channel-pricing.registry';
import { CompanySettings } from '../company/entities/company-settings.entity';
import { ServiceSettingsService } from '../company/service-settings/service-settings.service';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ChannelCharge } from './entities/channel-charge.entity';
import { ChannelRate } from './entities/channel-rate.entity';
import type { ChannelStatusReportedEvent } from './events/channel-status-reported.event';

export const BUDGET_NOTIFICATION_TYPE = NotificationTypeSchema.enum.spend_budget;
const BUDGET_TITLES: Record<Exclude<BudgetThreshold, 'none'>, string> = {
  warning: 'Presupuesto de mensajería al 80 %',
  exceeded: 'Presupuesto de mensajería superado',
};
const BUDGET_BODIES: Record<Exclude<BudgetThreshold, 'none'>, string> = {
  warning: 'El gasto del mes llegó al 80 % del presupuesto.',
  exceeded:
    'El gasto del mes superó el presupuesto. Podés pausar los envíos cobrables desde el panel de gasto.',
};

interface ChargeRow {
  channelType: ChannelType;
  category: string;
  billable: boolean;
  occurredAt: Date;
}

/**
 * Channel spend (approximate): charges reported by each provider's pricing
 * adapter × the company's editable rates, the monthly budget with its
 * 80 % / 100 % alerts, and the manual pause of billable sends.
 */
@Injectable()
export class SpendService {
  constructor(
    @InjectRepository(ChannelCharge) private readonly charges: Repository<ChannelCharge>,
    @InjectRepository(ChannelRate) private readonly rates: Repository<ChannelRate>,
    @InjectRepository(CompanySettings) private readonly settings: Repository<CompanySettings>,
    private readonly pricing: ChannelPricingRegistry,
    private readonly serviceSettings: ServiceSettingsService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
    @Optional() private readonly eventBus?: EventBus,
  ) {
    this.logger.setContext(SpendService.name);
  }

  /**
   * Records what the provider reported for one message (once per message)
   * and checks the budget when it was billable.
   */
  async recordReport(event: ChannelStatusReportedEvent): Promise<void> {
    const conversation = await this.dataSource.getRepository(Conversation).findOne({
      where: { id: event.conversationId },
      relations: { channel: true },
    });
    const channelType = conversation?.channel?.type;
    if (!conversation || !channelType) return;

    const charge = this.pricing.for(channelType)?.extractCharge(event.report);
    if (!charge) return;

    try {
      await this.charges.save(
        this.charges.create({
          companyId: event.companyId,
          channelId: conversation.channelId,
          channelType,
          messageId: event.messageId,
          category: charge.category,
          billable: charge.billable,
          pricingModel: charge.pricingModel,
          occurredAt: event.occurredAt,
        }),
      );
    } catch (error) {
      // Every status tick repeats the report: the first one wins.
      if (isDuplicateKeyError(error)) return;
      throw error;
    }

    this.eventBus?.publish(new AnalyticsSignalEvent(event.companyId, ['spend']));
    if (charge.billable) await this.checkBudget(event.companyId);
  }

  /**
   * True when the company paused billable sends and this message would be
   * billable on its channel (free messages always go through).
   */
  async isBillableSendBlocked(
    companyId: string,
    channelType: ChannelType,
    messageType: string,
  ): Promise<boolean> {
    const pricing = this.pricing.for(channelType);
    if (!pricing?.isBillableSend({ messageType })) return false;

    const row = await this.settings.findOne({
      where: { companyId },
      select: { companyId: true, billableSendsPaused: true },
    });
    return row?.billableSendsPaused === true;
  }

  async summary(companyId: string, month?: string): Promise<SpendSummary> {
    const { timezone } = await this.serviceSettings.get(companyId);
    const now = Date.now();
    const targetMonth = month ?? zonedMonthKey(now, timezone);
    const bounds = zonedMonthBounds(targetMonth, timezone);
    const until = Math.min(bounds.to, now);

    const [rows, rates, settings, resolvedCases] = await Promise.all([
      this.chargesBetween(companyId, bounds.from, bounds.to),
      this.listRates(companyId),
      this.settings.findOne({ where: { companyId } }),
      this.dataSource
        .getRepository(Case)
        .createQueryBuilder('c')
        .where('c.company_id = :companyId', { companyId })
        .andWhere('c.closed_at >= :from AND c.closed_at < :to', {
          from: new Date(bounds.from),
          to: new Date(bounds.to),
        })
        .getCount(),
    ]);

    const rateOf = new Map(rates.map((rate) => [`${rate.channelType}:${rate.category}`, rate.usdPerUnit]));
    const price = (row: Pick<ChargeRow, 'channelType' | 'category'>) =>
      rateOf.get(`${row.channelType}:${row.category}`) ?? 0;

    // Channel → category → counts (rate rows first, so known categories show at 0).
    const byChannel = new Map<ChannelType, Map<string, { billable: number; free: number }>>();
    const bucket = (channelType: ChannelType, category: string) => {
      let categories = byChannel.get(channelType);
      if (!categories) {
        categories = new Map<string, { billable: number; free: number }>();
        byChannel.set(channelType, categories);
      }
      let counts = categories.get(category);
      if (!counts) categories.set(category, (counts = { billable: 0, free: 0 }));
      return counts;
    };
    for (const rate of rates) bucket(rate.channelType, rate.category);

    const dailyKeys =
      bounds.from <= until ? zonedDateKeys(bounds.from, Math.max(bounds.from, until - 1), timezone) : [];
    const daily = new Map(dailyKeys.map((key) => [key, 0]));
    let totalUsd = 0;
    let billableCount = 0;
    let freeCount = 0;

    for (const row of rows) {
      const counts = bucket(row.channelType, row.category);
      if (row.billable) {
        counts.billable++;
        billableCount++;
        const amount = price(row);
        totalUsd += amount;
        const key = zonedDateKey(row.occurredAt, timezone);
        daily.set(key, (daily.get(key) ?? 0) + amount);
      } else {
        counts.free++;
        freeCount++;
      }
    }

    const budget = settings?.monthlyBudgetUsd ?? null;
    const consumedShare = budget ? totalUsd / budget : null;
    const dailyTotals = [...daily.values()];
    const isPast = bounds.to <= now;

    return {
      month: targetMonth,
      currency: 'USD',
      totalUsd: round(totalUsd, 2),
      billableCount,
      freeCount,
      byChannel: [...byChannel.entries()].map(([channelType, categories]) => {
        const list = [...categories.entries()].map(([category, counts]) => {
          const usdPerUnit = rateOf.get(`${channelType}:${category}`) ?? 0;
          return {
            category,
            billableCount: counts.billable,
            freeCount: counts.free,
            usdPerUnit,
            totalUsd: round(counts.billable * usdPerUnit, 2),
          };
        });
        return {
          channelType,
          totalUsd: round(list.reduce((sum, item) => sum + item.totalUsd, 0), 2),
          categories: list,
        };
      }),
      daily: [...daily.entries()].map(([date, amount]) => ({
        date,
        totalUsd: round(amount, 2),
      })),
      projection: isPast
        ? {
            expectedUsd: round(totalUsd, 2),
            lowUsd: round(totalUsd, 2),
            highUsd: round(totalUsd, 2),
            meta: sufficiency(dailyTotals.length, 1),
          }
        : rows.length
          ? projectionOf(dailyTotals, totalUsd, bounds.daysInMonth)
          : null,
      budget: {
        monthlyBudgetUsd: budget,
        consumedShare: consumedShare === null ? null : round(consumedShare),
        threshold: thresholdOf(consumedShare),
      },
      costPerResolvedCaseUsd: resolvedCases > 0 ? round(totalUsd / resolvedCases, 4) : null,
      billableSendsPaused: settings?.billableSendsPaused ?? false,
      rates,
    };
  }

  /**
   * Effective rates: the pricing adapter defaults of every channel the
   * company uses, overridden by the company's own table.
   */
  async listRates(companyId: string): Promise<ChannelRateDto[]> {
    const [channels, stored] = await Promise.all([
      this.dataSource.getRepository(Channel).find({
        where: { companyId, deletedAt: IsNull() },
        select: { id: true, type: true },
      }),
      this.rates.find({ where: { companyId } }),
    ]);

    const result = new Map<string, ChannelRateDto>();
    for (const type of new Set(channels.map((channel) => channel.type))) {
      const pricing = this.pricing.for(type);
      if (!pricing) continue;
      const defaults = pricing.defaultRates();
      for (const category of pricing.categories()) {
        result.set(`${type}:${category}`, {
          channelType: type,
          category,
          usdPerUnit: defaults[category] ?? 0,
        });
      }
    }
    for (const rate of stored) {
      result.set(`${rate.channelType}:${rate.category}`, {
        channelType: rate.channelType,
        category: rate.category,
        usdPerUnit: rate.usdPerUnit,
      });
    }

    return [...result.values()];
  }

  async updateRates(companyId: string, rates: ChannelRateDto[]): Promise<void> {
    for (const rate of rates) {
      const existing = await this.rates.findOne({
        where: { companyId, channelType: rate.channelType, category: rate.category },
      });
      await this.rates.save(
        existing
          ? Object.assign(existing, { usdPerUnit: rate.usdPerUnit })
          : this.rates.create({ companyId, ...rate }),
      );
    }
    this.eventBus?.publish(new AnalyticsSignalEvent(companyId, ['spend']));
  }

  async updateBudget(companyId: string, monthlyBudgetUsd: number | null): Promise<void> {
    const row = await this.settingsRow(companyId);
    row.monthlyBudgetUsd = monthlyBudgetUsd;
    // A new budget re-arms the alerts for the current month.
    row.budgetAlertKey = null;
    await this.settings.save(row);
    this.eventBus?.publish(new AnalyticsSignalEvent(companyId, ['spend']));
    await this.checkBudget(companyId);
  }

  async setPaused(companyId: string, paused: boolean): Promise<void> {
    const row = await this.settingsRow(companyId);
    row.billableSendsPaused = paused;
    await this.settings.save(row);
    this.eventBus?.publish(new AnalyticsSignalEvent(companyId, ['spend']));
  }

  /**
   * Alerts every active admin once per month and level (warning at 80 %,
   * exceeded at 100 %), as a persisted notification pushed live.
   */
  private async checkBudget(companyId: string): Promise<void> {
    try {
      const row = await this.settings.findOne({ where: { companyId } });
      const budget = row?.monthlyBudgetUsd ?? null;
      if (!row || !budget) return;

      const { timezone } = await this.serviceSettings.get(companyId);
      const month = zonedMonthKey(Date.now(), timezone);
      const bounds = zonedMonthBounds(month, timezone);
      const rates = await this.listRates(companyId);
      const rateOf = new Map(rates.map((rate) => [`${rate.channelType}:${rate.category}`, rate.usdPerUnit]));
      const total = (await this.chargesBetween(companyId, bounds.from, bounds.to))
        .filter((charge) => charge.billable)
        .reduce((sum, charge) => sum + (rateOf.get(`${charge.channelType}:${charge.category}`) ?? 0), 0);

      const threshold = thresholdOf(total / budget);
      if (threshold === 'none') return;

      const key = `${month}:${threshold}`;
      const alreadyExceeded = row.budgetAlertKey === `${month}:exceeded`;
      if (row.budgetAlertKey === key || alreadyExceeded) return;

      row.budgetAlertKey = key;
      await this.settings.save(row);
      await this.notifyAdmins(companyId, threshold, { month, totalUsd: round(total, 2), budget });
    } catch (error) {
      this.logger.warn({ companyId, error: String(error) }, 'Budget check failed');
    }
  }

  private async notifyAdmins(
    companyId: string,
    threshold: Exclude<BudgetThreshold, 'none'>,
    data: Record<string, unknown>,
  ): Promise<void> {
    const admins = await this.dataSource.getRepository(CompanyMember).find({
      where: { companyId, role: 'admin', status: 'active' },
      select: { id: true, userId: true },
    });

    for (const admin of admins) {
      const notification = await this.notifications.create({
        companyId,
        recipientMemberId: admin.id,
        type: BUDGET_NOTIFICATION_TYPE,
        title: BUDGET_TITLES[threshold],
        body: BUDGET_BODIES[threshold],
        data: { ...data, threshold },
      });
      if (!notification) continue;

      this.eventBus?.publish(
        new RealtimeNotificationEvent(admin.userId, {
          id: notification.id,
          title: notification.title,
          body: notification.body ?? null,
          data: notification.data ?? null,
          readAt: notification.readAt ?? null,
          time: notification.createdAt,
        }),
      );
    }
  }

  private async settingsRow(companyId: string): Promise<CompanySettings> {
    return (
      (await this.settings.findOne({ where: { companyId } })) ??
      this.settings.create({ companyId })
    );
  }

  private async chargesBetween(companyId: string, from: number, to: number): Promise<ChargeRow[]> {
    const rows = await this.charges
      .createQueryBuilder('charge')
      .select('charge.channel_type', 'channelType')
      .addSelect('charge.category', 'category')
      .addSelect('charge.billable', 'billable')
      .addSelect('charge.occurred_at', 'occurredAt')
      .where('charge.company_id = :companyId', { companyId })
      .andWhere('charge.occurred_at >= :from AND charge.occurred_at < :to', {
        from: new Date(from),
        to: new Date(to),
      })
      .getRawMany<{ channelType: ChannelType; category: string; billable: unknown; occurredAt: unknown }>();

    return rows.map((row) => ({
      channelType: row.channelType,
      category: row.category,
      billable: row.billable === true || row.billable === 1 || row.billable === '1',
      occurredAt: toDate(row.occurredAt),
    }));
  }
}

export function thresholdOf(share: number | null): BudgetThreshold {
  if (share === null || !Number.isFinite(share)) return 'none';
  if (share >= 1) return 'exceeded';
  if (share >= BUDGET_WARNING_SHARE) return 'warning';
  return 'none';
}

function projectionOf(dailyTotals: number[], spent: number, daysInMonth: number) {
  const projection = runRateProjection({
    dailyTotals,
    spentSoFar: spent,
    remainingDays: daysInMonth - dailyTotals.length,
  });
  if (!projection) return null;
  return {
    expectedUsd: projection.expected,
    lowUsd: projection.low,
    highUsd: projection.high,
    meta: projection.meta,
  };
}

/**
 * Raw datetime from the driver: a Date (mysql2) or a `YYYY-MM-DD HH:MM:SS`
 * UTC string (better-sqlite3).
 */
export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  }
  return new Date(Number(value));
}
