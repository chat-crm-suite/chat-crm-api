// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

/**
 * Support case: one unit of work inside a conversation thread. A case opens
 * on the first inbound message when the conversation has no open case and
 * closes explicitly. A case opened within `REOPEN_WINDOW_HOURS` of the
 * previous close is a reopen (`reopenOfCaseId` points at it).
 */
export const CASE_STATUSES = ['open', 'closed'] as const;
export const CaseStatusSchema = z.enum(CASE_STATUSES);
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

export const REOPEN_WINDOW_HOURS = 72;

export const CaseSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  status: CaseStatusSchema,
  openedAt: z.coerce.date(),
  firstResponseAt: z.coerce.date().nullable(),
  firstResponderMemberId: z.string().nullable(),
  closedAt: z.coerce.date().nullable(),
  closedByMemberId: z.string().nullable(),
  reopenOfCaseId: z.string().nullable(),
});
export type Case = z.infer<typeof CaseSchema>;

/** `GET /conversations/:id/case`: the latest case of the thread, if any. */
export const CurrentCaseSchema = z.object({
  case: CaseSchema.nullable(),
});
export type CurrentCase = z.infer<typeof CurrentCaseSchema>;

/**
 * `POST /conversations/:id/close` body. Closing a conversation without an
 * open case answers 409. Responds with `CaseSchema`.
 */
export const CloseCaseSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type CloseCaseInput = z.infer<typeof CloseCaseSchema>;
