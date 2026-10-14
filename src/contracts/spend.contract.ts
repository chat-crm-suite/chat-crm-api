// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import { DataSufficiencySchema, MonthSchema } from './analytics.contract';
import { ChannelTypeSchema } from './channel.contract';

/**
 * Channel spend (approximate). Each channel's pricing adapter decides which
 * outbound messages are billable and their category (WhatsApp: Meta's
 * `pricing` object on status webhooks); the amount is `count × rate` from the
 * company's editable rate table. Currency is always USD.
 */

/** Meta per-message categories (pricing model since 2025-07-01). */
export const WHATSAPP_CHARGE_CATEGORIES = [
  'marketing',
  'utility',
  'authentication',
  'authentication_international',
  'service',
] as const;

/** Category names are channel-specific, so they stay free-form here. */
export const ChargeCategorySchema = z.string().min(1).max(50);

export const ChannelRateSchema = z.object({
  channelType: ChannelTypeSchema,
  category: ChargeCategorySchema,
  usdPerUnit: z.number().nonnegative().max(100),
});
export type ChannelRate = z.infer<typeof ChannelRateSchema>;

/** `PUT /billing/rates` body (upsert by channel + category). */
export const UpdateChannelRatesSchema = z.object({
  rates: z.array(ChannelRateSchema).min(1).max(50),
});
export type UpdateChannelRatesInput = z.infer<typeof UpdateChannelRatesSchema>;

/** `PUT /billing/budget` body; null removes the budget. */
export const UpdateBudgetSchema = z.object({
  monthlyBudgetUsd: z.number().positive().max(1_000_000).nullable(),
});
export type UpdateBudgetInput = z.infer<typeof UpdateBudgetSchema>;

/**
 * `POST /billing/pause` body. While paused, the outbound sender rejects
 * messages the channel adapter reports as billable; free messages still go.
 */
export const BillablePauseSchema = z.object({
  paused: z.boolean(),
});
export type BillablePauseInput = z.infer<typeof BillablePauseSchema>;

export const SpendQuerySchema = z.object({
  month: MonthSchema.optional(),
});
export type SpendQuery = z.infer<typeof SpendQuerySchema>;

export const SpendCategorySchema = z.object({
  category: ChargeCategorySchema,
  billableCount: z.number().int().nonnegative(),
  freeCount: z.number().int().nonnegative(),
  usdPerUnit: z.number().nonnegative(),
  totalUsd: z.number().nonnegative(),
});

export const ChannelSpendSchema = z.object({
  channelType: ChannelTypeSchema,
  totalUsd: z.number().nonnegative(),
  categories: z.array(SpendCategorySchema),
});

export const BUDGET_THRESHOLDS = ['none', 'warning', 'exceeded'] as const;
export const BudgetThresholdSchema = z.enum(BUDGET_THRESHOLDS);
export type BudgetThreshold = z.infer<typeof BudgetThresholdSchema>;

/** `warning` from 80% of the monthly budget, `exceeded` from 100%. */
export const BUDGET_WARNING_SHARE = 0.8;

/**
 * Month-end run-rate projection: mean daily spend × days in month, with a
 * 95% Student-t interval on the daily variance. Null before the floor.
 */
export const SpendProjectionSchema = z.object({
  expectedUsd: z.number().nonnegative(),
  lowUsd: z.number().nonnegative(),
  highUsd: z.number().nonnegative(),
  meta: DataSufficiencySchema,
});

/** `GET /billing/spend?month=` (admin). */
export const SpendSummarySchema = z.object({
  month: MonthSchema,
  currency: z.literal('USD'),
  totalUsd: z.number().nonnegative(),
  billableCount: z.number().int().nonnegative(),
  freeCount: z.number().int().nonnegative(),
  byChannel: z.array(ChannelSpendSchema),
  daily: z.array(
    z.object({
      date: z.string(),
      totalUsd: z.number().nonnegative(),
    }),
  ),
  projection: SpendProjectionSchema.nullable(),
  budget: z.object({
    monthlyBudgetUsd: z.number().positive().nullable(),
    consumedShare: z.number().nonnegative().nullable(),
    threshold: BudgetThresholdSchema,
  }),
  costPerResolvedCaseUsd: z.number().nonnegative().nullable(),
  billableSendsPaused: z.boolean(),
  rates: z.array(ChannelRateSchema),
});
export type SpendSummary = z.infer<typeof SpendSummarySchema>;

/** Error code answered (409) by the sender while billable sends are paused. */
export const BILLABLE_SENDS_PAUSED_ERROR = 'billable_sends_paused' as const;
