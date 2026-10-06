// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

/**
 * Message template contracts (provider-approved templates, e.g. WhatsApp HSM).
 */
export const TEMPLATE_CATEGORIES = [
  'marketing',
  'utility',
  'authentication',
] as const;
export const TemplateCategorySchema = z.enum(TEMPLATE_CATEGORIES);
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;

export const TEMPLATE_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'paused',
  'disabled',
] as const;
export const TemplateStatusSchema = z.enum(TEMPLATE_STATUSES);
export type TemplateStatus = z.infer<typeof TemplateStatusSchema>;
