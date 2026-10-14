// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

/**
 * Service settings of a company: the business clock used by every analytics
 * duration and the first-response SLA. `GET` / `PUT /company/service-settings`
 * (PUT: admin only).
 */
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TimeIntervalSchema = z
  .object({
    start: z.string().regex(TIME_OF_DAY, 'validations.timeOfDay'),
    end: z.string().regex(TIME_OF_DAY, 'validations.timeOfDay'),
  })
  .refine((v) => v.start < v.end, {
    message: 'validations.timeRange',
    path: ['end'],
  });
export type TimeInterval = z.infer<typeof TimeIntervalSchema>;

export const BusinessDaySchema = z.object({
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: z.number().int().min(1).max(7),
  intervals: z.array(TimeIntervalSchema).max(4),
});
export type BusinessDay = z.infer<typeof BusinessDaySchema>;

/** Weekdays missing from `days` (or with no intervals) are closed. */
export const BusinessHoursSchema = z.object({
  /** IANA timezone, e.g. `America/Lima`. */
  timezone: z.string().min(1).max(64),
  days: z.array(BusinessDaySchema).max(7),
});
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

export const DEFAULT_SLA_FIRST_RESPONSE_SECONDS = 300;
export const DEFAULT_SLA_TARGET_SHARE = 0.8;

export const ServiceSettingsSchema = z.object({
  /** Null = 24/7 on the server timezone (`APP_TZ`). */
  businessHours: BusinessHoursSchema.nullable(),
  slaFirstResponseSeconds: z.number().int().min(30).max(86_400),
  /** Target share answered within the SLA (Erlang C goal). */
  slaTargetShare: z.number().min(0.5).max(0.99),
});
export type ServiceSettings = z.infer<typeof ServiceSettingsSchema>;

export const UpdateServiceSettingsSchema = ServiceSettingsSchema.partial();
export type UpdateServiceSettingsInput = z.infer<
  typeof UpdateServiceSettingsSchema
>;
