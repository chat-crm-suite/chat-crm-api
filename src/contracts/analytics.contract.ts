// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import { ChannelTypeSchema } from './channel.contract';
import { MemberRoleSchema } from './member.contract';
import { PresenceStateSchema } from './presence.contract';

/**
 * Analytics v2 contracts (`/analytics/*`), replacing the legacy `/metrics/*`
 * queries. Conventions shared by every payload:
 *
 * - Durations are **seconds** measured on the company's business clock
 *   (`ServiceSettings.businessHours`, 24/7 when null), except live waits,
 *   which are wall-clock.
 * - Rates are fractions in `[0, 1]`, never percentages.
 * - Every statistical block carries `meta` (`DataSufficiency`): consumers must
 *   render `empty` / `insufficient` as such instead of drawing the numbers.
 *   Values that cannot be computed are `null`, never `NaN` or a fake zero.
 * - Payloads always have their full shape, even on an empty database.
 * - Tone fields are `null` whenever the sentiment IA is unavailable
 *   (`IaStatus.available === false`).
 */

// ---------------------------------------------------------------------------
// Query inputs
// ---------------------------------------------------------------------------

export const ANALYTICS_PERIODS = ['today', '7d', '30d', '90d'] as const;
export const AnalyticsPeriodSchema = z.enum(ANALYTICS_PERIODS);
export type AnalyticsPeriod = z.infer<typeof AnalyticsPeriodSchema>;

/** `all` or a single channel type; every analytics query accepts it. */
export const ChannelFilterSchema = z
  .union([z.literal('all'), ChannelTypeSchema])
  .default('all');
export type ChannelFilter = z.infer<typeof ChannelFilterSchema>;

/** Calendar month `YYYY-MM` (payroll/billing periods). */
export const MonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'validations.month');
export type Month = z.infer<typeof MonthSchema>;

/**
 * Range query. `month` (when present) wins over `period` so payroll views can
 * ask for a closed calendar month.
 */
export const AnalyticsRangeQuerySchema = z.object({
  period: AnalyticsPeriodSchema.default('7d'),
  month: MonthSchema.optional(),
  channel: ChannelFilterSchema,
});
export type AnalyticsRangeQuery = z.infer<typeof AnalyticsRangeQuerySchema>;

export const LiveQuerySchema = z.object({
  channel: ChannelFilterSchema,
});
export type LiveQuery = z.infer<typeof LiveQuerySchema>;

export const CONTROL_METRICS = [
  'first-response',
  'service-level',
  'resolved-cases',
  'negative-tone',
] as const;
export const ControlMetricSchema = z.enum(CONTROL_METRICS);
export type ControlMetric = z.infer<typeof ControlMetricSchema>;

export const AgentControlParamsSchema = z.object({
  memberId: z.uuid(),
});
export const AgentControlQuerySchema = AnalyticsRangeQuerySchema.extend({
  metric: ControlMetricSchema,
});
export type AgentControlQuery = z.infer<typeof AgentControlQuerySchema>;

export const SENTIMENT_SCOPES = ['company', 'me'] as const;
export const SentimentAnalyticsQuerySchema = AnalyticsRangeQuerySchema.extend({
  scope: z.enum(SENTIMENT_SCOPES).default('company'),
});
export type SentimentAnalyticsQuery = z.infer<
  typeof SentimentAnalyticsQuerySchema
>;

export const PerformanceExportQuerySchema = z.object({
  month: MonthSchema,
  channel: ChannelFilterSchema,
});
export type PerformanceExportQuery = z.infer<
  typeof PerformanceExportQuerySchema
>;

// ---------------------------------------------------------------------------
// Statistical building blocks
// ---------------------------------------------------------------------------

export const DATA_SUFFICIENCY_STATUSES = ['ok', 'insufficient', 'empty'] as const;
export const DataSufficiencyStatusSchema = z.enum(DATA_SUFFICIENCY_STATUSES);

/**
 * `empty` = no observations; `insufficient` = fewer than `minimumSample`
 * (the method's floor: percentiles 5, XmR 8 points, ...); `ok` otherwise.
 */
export const DataSufficiencySchema = z.object({
  status: DataSufficiencyStatusSchema,
  sampleSize: z.number().int().nonnegative(),
  minimumSample: z.number().int().nonnegative(),
});
export type DataSufficiency = z.infer<typeof DataSufficiencySchema>;

export const IntervalSchema = z.object({
  low: z.number(),
  high: z.number(),
});
export type Interval = z.infer<typeof IntervalSchema>;

/** Median and 90th percentile of a duration sample (seconds). */
export const DurationSummarySchema = z.object({
  median: z.number().nonnegative().nullable(),
  p90: z.number().nonnegative().nullable(),
  meta: DataSufficiencySchema,
});
export type DurationSummary = z.infer<typeof DurationSummarySchema>;

/**
 * A proportion `successes / trials` with its 95% Wilson score interval.
 * `adjusted` is the empirical-Bayes (beta-binomial) shrunk rate, present only
 * in cross-agent comparisons; `null` when fewer than 3 agents have data.
 */
export const RateEstimateSchema = z.object({
  value: z.number().min(0).max(1).nullable(),
  successes: z.number().int().nonnegative(),
  trials: z.number().int().nonnegative(),
  interval: IntervalSchema.nullable(),
  adjusted: z.number().min(0).max(1).nullable(),
  meta: DataSufficiencySchema,
});
export type RateEstimate = z.infer<typeof RateEstimateSchema>;

/** Log-spaced bins; the last bin is open-ended (`toSeconds: null`). */
export const HistogramBinSchema = z.object({
  fromSeconds: z.number().nonnegative(),
  toSeconds: z.number().nonnegative().nullable(),
  count: z.number().int().nonnegative(),
});
export const HistogramSchema = z.object({
  bins: z.array(HistogramBinSchema),
  meta: DataSufficiencySchema,
});
export type Histogram = z.infer<typeof HistogramSchema>;

/**
 * Western Electric signals evaluated on an XmR chart: a point beyond the
 * ±3σ limits, or 8 consecutive points on the same side of the center line.
 */
export const CONTROL_SIGNALS = ['none', 'beyond-limits', 'run-of-8'] as const;
export const ControlSignalSchema = z.enum(CONTROL_SIGNALS);

export const ControlPointSchema = z.object({
  /** Day `YYYY-MM-DD` in the company timezone. */
  date: z.string(),
  value: z.number().nullable(),
  signal: ControlSignalSchema,
});

/** Shewhart individuals (XmR) chart. Limits are null while insufficient. */
export const ControlChartSchema = z.object({
  points: z.array(ControlPointSchema),
  center: z.number().nullable(),
  upperLimit: z.number().nullable(),
  lowerLimit: z.number().nullable(),
  meta: DataSufficiencySchema,
});
export type ControlChart = z.infer<typeof ControlChartSchema>;

export const AnalyticsRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  period: AnalyticsPeriodSchema.nullable(),
  month: MonthSchema.nullable(),
  timezone: z.string(),
});
export type AnalyticsRange = z.infer<typeof AnalyticsRangeSchema>;

export const MemberRefSchema = z.object({
  memberId: z.string(),
  displayName: z.string(),
});
export type MemberRef = z.infer<typeof MemberRefSchema>;

// ---------------------------------------------------------------------------
// GET /analytics/live — the floor, right now
// ---------------------------------------------------------------------------

export const SLA_STATES = ['ok', 'risk', 'breach'] as const;
export const SlaStateSchema = z.enum(SLA_STATES);
export type SlaState = z.infer<typeof SlaStateSchema>;

/** A customer whose last message has not been answered yet. */
export const WaitingCustomerSchema = z.object({
  caseId: z.string(),
  conversationId: z.string(),
  channelType: ChannelTypeSchema,
  customer: z.object({
    id: z.string(),
    displayName: z.string().nullable(),
  }),
  /** Null = sitting in the unassigned queue. */
  assignee: MemberRefSchema.nullable(),
  waitingSince: z.coerce.date(),
  /** Wall-clock seconds at `generatedAt`; clients keep ticking locally. */
  waitingSeconds: z.number().nonnegative(),
  slaState: SlaStateSchema,
});
export type WaitingCustomer = z.infer<typeof WaitingCustomerSchema>;

export const QUEUE_TRENDS = ['stable', 'building', 'draining'] as const;
export const QueueTrendSchema = z.enum(QUEUE_TRENDS);

/**
 * Little's law: expected queue length `L = λ·W` with λ = arrivals in the last
 * hour and W = median wait. `building` when the observed queue stays above L.
 */
export const QueuePressureSchema = z.object({
  arrivalsPerHour: z.number().nonnegative(),
  medianWaitSeconds: z.number().nonnegative().nullable(),
  expectedQueueLength: z.number().nonnegative().nullable(),
  observedQueueLength: z.number().int().nonnegative(),
  trend: QueueTrendSchema,
  meta: DataSufficiencySchema,
});
export type QueuePressure = z.infer<typeof QueuePressureSchema>;

export const AgentFloorRowSchema = z.object({
  memberId: z.string(),
  displayName: z.string(),
  role: MemberRoleSchema,
  presence: PresenceStateSchema,
  presenceSince: z.coerce.date().nullable(),
  openCases: z.number().int().nonnegative(),
  /** `company_members.max_open_conversations`; null = unlimited. */
  capacity: z.number().int().positive().nullable(),
  waitingCount: z.number().int().nonnegative(),
  oldestWaitingSeconds: z.number().nonnegative().nullable(),
  firstResponseTodayMedian: z.number().nonnegative().nullable(),
  /** Share of today's analyzed inbound messages labelled negative. */
  negativeToneShare: z.number().min(0).max(1).nullable(),
});
export type AgentFloorRow = z.infer<typeof AgentFloorRowSchema>;

/**
 * Role-shaped snapshot. Agents get only their own waiting customers plus the
 * unassigned queue, `agents: []` and `queuePressure: null`; supervisors and
 * admins get the whole company.
 */
export const LiveSnapshotSchema = z.object({
  generatedAt: z.coerce.date(),
  slaSeconds: z.number().int().positive(),
  /** Longest waits first, capped at 50 rows; see `waitingTotal`. */
  waiting: z.array(WaitingCustomerSchema),
  waitingTotal: z.number().int().nonnegative(),
  queue: z.object({
    unassignedCount: z.number().int().nonnegative(),
    oldestWaitingSeconds: z.number().nonnegative().nullable(),
  }),
  queuePressure: QueuePressureSchema.nullable(),
  agents: z.array(AgentFloorRowSchema),
  me: AgentFloorRowSchema.nullable(),
});
export type LiveSnapshot = z.infer<typeof LiveSnapshotSchema>;

// ---------------------------------------------------------------------------
// GET /analytics/me and GET /analytics/agents — performance over a range
// ---------------------------------------------------------------------------

export const MessagesPerCaseSchema = z.object({
  inboundMedian: z.number().nonnegative().nullable(),
  outboundMedian: z.number().nonnegative().nullable(),
  meta: DataSufficiencySchema,
});

export const AgentPerformanceSchema = z.object({
  memberId: z.string(),
  displayName: z.string(),
  role: MemberRoleSchema,
  handledCases: z.number().int().nonnegative(),
  resolvedCases: z.number().int().nonnegative(),
  connectedSeconds: z.number().nonnegative(),
  availableSeconds: z.number().nonnegative(),
  /** Time with ≥1 active case / available time. */
  occupancy: z.number().min(0).max(1).nullable(),
  firstResponse: DurationSummarySchema,
  replyTime: DurationSummarySchema,
  resolutionTime: DurationSummarySchema,
  /** First response within `slaSeconds`. */
  serviceLevel: RateEstimateSchema,
  reopenRate: RateEstimateSchema,
  transferRate: RateEstimateSchema,
  messagesPerCase: MessagesPerCaseSchema,
  /** Null when the sentiment IA is unavailable. */
  negativeTone: RateEstimateSchema.nullable(),
});
export type AgentPerformance = z.infer<typeof AgentPerformanceSchema>;

/** Anonymous team reference: medians across agents, no names. */
export const TeamReferenceSchema = z.object({
  agentCount: z.number().int().nonnegative(),
  firstResponseMedian: z.number().nonnegative().nullable(),
  firstResponseP90: z.number().nonnegative().nullable(),
  serviceLevel: z.number().min(0).max(1).nullable(),
  resolutionTimeMedian: z.number().nonnegative().nullable(),
  reopenRate: z.number().min(0).max(1).nullable(),
});
export type TeamReference = z.infer<typeof TeamReferenceSchema>;

/** `GET /analytics/me` — the calling member, any role. */
export const MyPerformanceSchema = z.object({
  range: AnalyticsRangeSchema,
  slaSeconds: z.number().int().positive(),
  performance: AgentPerformanceSchema,
  firstResponseHistogram: HistogramSchema,
  /** Daily median first response (XmR). */
  firstResponseControl: ControlChartSchema,
  team: TeamReferenceSchema,
  openCases: z.number().int().nonnegative(),
  capacity: z.number().int().positive().nullable(),
});
export type MyPerformance = z.infer<typeof MyPerformanceSchema>;

/** `GET /analytics/agents` — supervisor/admin comparison table. */
export const AgentsPerformanceSchema = z.object({
  range: AnalyticsRangeSchema,
  slaSeconds: z.number().int().positive(),
  agents: z.array(AgentPerformanceSchema),
  team: TeamReferenceSchema,
});
export type AgentsPerformance = z.infer<typeof AgentsPerformanceSchema>;

/** `GET /analytics/agents/:memberId/control?metric=`. */
export const AgentControlSchema = z.object({
  range: AnalyticsRangeSchema,
  member: MemberRefSchema,
  metric: ControlMetricSchema,
  chart: ControlChartSchema,
});
export type AgentControl = z.infer<typeof AgentControlSchema>;

// ---------------------------------------------------------------------------
// GET /analytics/staffing — Erlang C + arrivals heatmap
// ---------------------------------------------------------------------------

export const StaffingHourSchema = z.object({
  /** Start of the hour (company timezone, serialized as an instant). */
  hourStart: z.coerce.date(),
  expectedArrivals: z.number().nonnegative(),
  /** Erlang C minimum agents meeting the target; null while insufficient. */
  requiredAgents: z.number().int().nonnegative().nullable(),
  availableAgents: z.number().int().nonnegative(),
});

export const ArrivalsHeatCellSchema = z.object({
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: z.number().int().min(1).max(7),
  hour: z.number().int().min(0).max(23),
  averageArrivals: z.number().nonnegative(),
});

export const StaffingSchema = z.object({
  slaSeconds: z.number().int().positive(),
  targetServiceLevel: z.number().min(0).max(1),
  /** Median handle time (AHT) used by Erlang C. */
  handleTimeSeconds: z.number().nonnegative().nullable(),
  historyDays: z.number().int().nonnegative(),
  /** Current hour plus the next 7. */
  hours: z.array(StaffingHourSchema),
  heatmap: z.array(ArrivalsHeatCellSchema),
  meta: DataSufficiencySchema,
});
export type Staffing = z.infer<typeof StaffingSchema>;

// ---------------------------------------------------------------------------
// GET /analytics/volume and GET /analytics/delivery — company trends
// ---------------------------------------------------------------------------

export const VolumeDaySchema = z.object({
  date: z.string(),
  newCases: z.number().int().nonnegative(),
  resolvedCases: z.number().int().nonnegative(),
  /** Open cases at the end of the day. */
  backlog: z.number().int().nonnegative(),
  inboundMessages: z.number().int().nonnegative(),
  outboundMessages: z.number().int().nonnegative(),
});

export const VolumeSchema = z.object({
  range: AnalyticsRangeSchema,
  days: z.array(VolumeDaySchema),
  newCasesControl: ControlChartSchema,
  customers: z.object({
    new: z.number().int().nonnegative(),
    returning: z.number().int().nonnegative(),
    casesPerCustomer: z.number().nonnegative().nullable(),
  }),
  meta: DataSufficiencySchema,
});
export type Volume = z.infer<typeof VolumeSchema>;

export const DeliveryErrorSchema = z.object({
  code: z.string(),
  message: z.string().nullable(),
  count: z.number().int().positive(),
});

/** Outbound delivery health; each rate is over `sent`. */
export const DeliverySchema = z.object({
  range: AnalyticsRangeSchema,
  sent: z.number().int().nonnegative(),
  delivered: RateEstimateSchema,
  read: RateEstimateSchema,
  failed: RateEstimateSchema,
  topErrors: z.array(DeliveryErrorSchema),
});
export type Delivery = z.infer<typeof DeliverySchema>;

// ---------------------------------------------------------------------------
// GET /analytics/sentiment — 409 `ia_unavailable` when the IA is off/down
// ---------------------------------------------------------------------------

export const ToneDaySchema = z.object({
  date: z.string(),
  positive: z.number().int().nonnegative(),
  neutral: z.number().int().nonnegative(),
  negative: z.number().int().nonnegative(),
});

export const ToneShareSchema = z.object({
  positive: z.number().min(0).max(1).nullable(),
  neutral: z.number().min(0).max(1).nullable(),
  negative: z.number().min(0).max(1).nullable(),
});

export const SentimentAnalyticsSchema = z.object({
  range: AnalyticsRangeSchema,
  scope: z.enum(SENTIMENT_SCOPES),
  days: z.array(ToneDaySchema),
  share: ToneShareSchema,
  /** Daily negative share (XmR) — flags real spikes, not noise. */
  negativeControl: ControlChartSchema,
  meta: DataSufficiencySchema,
});
export type SentimentAnalytics = z.infer<typeof SentimentAnalyticsSchema>;

/** Error code of the 409 answered by tone endpoints while the IA is down. */
export const IA_UNAVAILABLE_ERROR = 'ia_unavailable' as const;

// ---------------------------------------------------------------------------
// GET /analytics/readiness — drives the welcome view on a fresh install
// ---------------------------------------------------------------------------

export const AnalyticsReadinessSchema = z.object({
  /** True while there is nothing at all to measure. */
  isEmpty: z.boolean(),
  channels: z.array(
    z.object({
      channelType: ChannelTypeSchema,
      connected: z.boolean(),
    }),
  ),
  firstMessageReceived: z.boolean(),
  businessHoursConfigured: z.boolean(),
  agentCount: z.number().int().nonnegative(),
  /** Days with activity; trend charts need `CONTROL_CHART_MIN_POINTS`. */
  activeDays: z.number().int().nonnegative(),
});
export type AnalyticsReadiness = z.infer<typeof AnalyticsReadinessSchema>;

// ---------------------------------------------------------------------------
// Method floors (shared so the UI can explain "N more days needed")
// ---------------------------------------------------------------------------

export const PERCENTILE_MIN_SAMPLE = 5;
export const CONTROL_CHART_MIN_POINTS = 8;
export const SHRINKAGE_MIN_AGENTS = 3;
export const STAFFING_MIN_HISTORY_DAYS = 14;
export const PROJECTION_MIN_DAYS = 3;
export const LIVE_WAITING_LIMIT = 50;

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

export const ANALYTICS_SCOPES = [
  'live',
  'cases',
  'presence',
  'spend',
  'sentiment',
] as const;
export const AnalyticsScopeSchema = z.enum(ANALYTICS_SCOPES);
export type AnalyticsScope = z.infer<typeof AnalyticsScopeSchema>;

/**
 * Server → client events on the `conversation` namespace, emitted to the
 * `company:{id}` room. Payloads carry no data: clients refetch the scopes.
 */
export const AnalyticsSocketEvent = {
  Changed: 'analytics:changed',
  IaStatusChanged: 'ia:status:changed',
  PresenceChanged: 'presence:changed',
} as const;
export type AnalyticsSocketEvent =
  (typeof AnalyticsSocketEvent)[keyof typeof AnalyticsSocketEvent];

/** `analytics:changed` (batched server-side, ~2 s per company). */
export const AnalyticsChangedEventSchema = z.object({
  companyId: z.string(),
  scopes: z.array(AnalyticsScopeSchema).min(1),
});
export type AnalyticsChangedEvent = z.infer<typeof AnalyticsChangedEventSchema>;
