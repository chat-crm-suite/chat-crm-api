// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import { ConversationStatusSchema } from './conversation.contract';
import { TableQueryBaseSchema } from './pagination.contract';

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

/** Tag attached to customers (`tags`, unique per company by name). */
export const TagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullish(),
});
export type Tag = z.infer<typeof TagSchema>;

export const CreateTagSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type CreateTagInput = z.infer<typeof CreateTagSchema>;

/** `PUT /customers/:id/tags` replaces the whole set. */
export const SetCustomerTagsSchema = z.object({
  tagIds: z.array(z.uuid()).max(50),
});
export type SetCustomerTagsInput = z.infer<typeof SetCustomerTagsSchema>;

/** Row of the customers table (owner, stage, tags and conversation summary). */
export const CustomerRowSchema = CustomerResponseSchema.extend({
  owner: z
    .object({
      memberId: z.string(),
      name: z.string(),
      avatarUrl: z.string().nullish(),
    })
    .nullable(),
  stage: z
    .object({
      id: z.string(),
      name: z.string(),
      color: z.string().nullish(),
    })
    .nullable(),
  tags: z.array(TagSchema),
  conversationsCount: z.number().int().min(0),
  /** Latest conversation in `open`/`pending`, if any. */
  openConversation: z
    .object({
      id: z.string(),
      status: ConversationStatusSchema,
      assignedMemberId: z.string().nullable(),
    })
    .nullable(),
});
export type CustomerRow = z.infer<typeof CustomerRowSchema>;

/** Filter value of `ownerMemberId[]` meaning "customers without an owner". */
export const NO_OWNER_FILTER = 'none';

/** `POST /customers/table` body. */
export const CustomerTableQuerySchema = TableQueryBaseSchema.extend({
  q: z.string().trim().max(100).optional(),
  stageId: z.array(z.string()).optional(),
  ownerMemberId: z.array(z.string()).optional(),
  tagId: z.array(z.string()).optional(),
  source: z.array(CustomerSourceSchema).optional(),
  lastInteractionFrom: z.coerce.date().optional(),
  lastInteractionTo: z.coerce.date().optional(),
});
export type CustomerTableQuery = z.infer<typeof CustomerTableQuerySchema>;

/**
 * Create/update result. `restored` is true when the phone belonged to a
 * soft-deleted customer that was brought back instead of failing.
 */
export const CustomerMutationResultSchema = z.object({
  customer: CustomerRowSchema,
  restored: z.boolean(),
});
export type CustomerMutationResult = z.infer<
  typeof CustomerMutationResultSchema
>;

/** 409 body when an active customer already uses the phone. */
export const CustomerConflictSchema = z.object({
  code: z.literal('customer_exists'),
  customerId: z.string(),
});
export type CustomerConflict = z.infer<typeof CustomerConflictSchema>;

/** `POST /customers/import` summary. */
export const CustomerImportResultSchema = z.object({
  created: z.number().int().min(0),
  restored: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type CustomerImportResult = z.infer<typeof CustomerImportResultSchema>;

/** `POST /customers/bulk-delete` (soft delete). */
export const BulkDeleteCustomersSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(100),
});
export type BulkDeleteCustomersInput = z.infer<
  typeof BulkDeleteCustomersSchema
>;

export const BulkDeleteCustomersResultSchema = z.object({
  deleted: z.number().int().min(0),
});
export type BulkDeleteCustomersResult = z.infer<
  typeof BulkDeleteCustomersResultSchema
>;

/** `GET /customers/stages`: the company pipeline, ordered by `position`. */
export const PipelineStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number().int(),
  color: z.string().nullish(),
  isWon: z.boolean(),
  isLost: z.boolean(),
});
export type PipelineStage = z.infer<typeof PipelineStageSchema>;
