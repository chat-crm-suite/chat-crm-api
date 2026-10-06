// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

/**
 * Customer contracts (v2). `customer_identities` is the resolution canon;
 * `customers.phone_number` is informational and normalized to `+digits`.
 */
export const CUSTOMER_SOURCES = ['whatsapp', 'manual', 'import', 'api'] as const;
export const CustomerSourceSchema = z.enum(CUSTOMER_SOURCES);
export type CustomerSource = z.infer<typeof CustomerSourceSchema>;

export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'multiselect',
] as const;
export const CustomFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;

/** Payload accepted by `POST /customers` / `PATCH /customers/:id`. */
export const CreateCustomerSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  displayName: z.string().max(200).optional(),
  email: z.email().max(255).optional(),
  phoneNumber: z.string().max(20).optional(),
  avatarUrl: z.string().optional(),
  source: CustomerSourceSchema.optional(),
  pipelineStageId: z.uuid().optional(),
  ownerMemberId: z.uuid().optional(),
});

export const UpdateCustomerSchema = CreateCustomerSchema.partial();

/** Entity shape returned by the customers endpoints. */
export const CustomerResponseSchema = z.object({
  id: z.string(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  displayName: z.string().nullish(),
  email: z.string().nullish(),
  phoneNumber: z.string().nullish(),
  avatarUrl: z.string().nullish(),
  source: CustomerSourceSchema,
  pipelineStageId: z.string().nullish(),
  ownerMemberId: z.string().nullish(),
  lastInteractionAt: z.coerce.date().nullish(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
export type CustomerResponse = z.infer<typeof CustomerResponseSchema>;
