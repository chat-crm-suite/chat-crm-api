// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import { ChannelTypeSchema } from './channel.contract';

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

export const TEMPLATE_COMPONENT_TYPES = [
  'header',
  'body',
  'footer',
  'buttons',
] as const;
export const TemplateComponentTypeSchema = z.enum(TEMPLATE_COMPONENT_TYPES);
export type TemplateComponentType = z.infer<typeof TemplateComponentTypeSchema>;

export const TEMPLATE_HEADER_FORMATS = [
  'text',
  'image',
  'video',
  'document',
  'location',
] as const;
export const TemplateHeaderFormatSchema = z.enum(TEMPLATE_HEADER_FORMATS);

export const TemplateButtonSchema = z.object({
  type: z.enum(['quick_reply', 'url', 'phone_number', 'copy_code', 'other']),
  text: z.string(),
  url: z.string().nullish(),
  phoneNumber: z.string().nullish(),
});

/**
 * Provider-neutral template component, normalized by each channel's
 * `TemplateProvider`. `text` keeps the provider placeholders (`{{1}}`,
 * `{{name}}`) so the preview can fill them with `renderTemplateText`.
 */
export const TemplateComponentSchema = z.object({
  type: TemplateComponentTypeSchema,
  format: TemplateHeaderFormatSchema.nullish(),
  text: z.string().nullish(),
  buttons: z.array(TemplateButtonSchema).nullish(),
});
export type TemplateComponent = z.infer<typeof TemplateComponentSchema>;

/**
 * One placeholder to fill when sending. `key` is the placeholder name without
 * braces (`1`, `name`), unique per template as `${component}:${key}`.
 */
export const TemplateVariableSchema = z.object({
  key: z.string(),
  component: TemplateComponentTypeSchema,
  /** CRM label set by an admin ("Nombre del cliente"); null = show the key. */
  label: z.string().nullable(),
  /** Sample value from the provider, used as placeholder text. */
  example: z.string().nullable(),
});
export type TemplateVariable = z.infer<typeof TemplateVariableSchema>;

/** `GET /templates` item. */
export const TemplateSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  channelType: ChannelTypeSchema,
  channelName: z.string(),
  name: z.string(),
  language: z.string(),
  category: TemplateCategorySchema,
  status: TemplateStatusSchema,
  /** Provider reason when `rejected`/`paused`. */
  statusReason: z.string().nullable(),
  components: z.array(TemplateComponentSchema),
  variables: z.array(TemplateVariableSchema),
  /** Agents only see (and send) approved templates with this flag on. */
  visibleToAgents: z.boolean(),
  externalId: z.string().nullable(),
  syncedAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date(),
});
export type Template = z.infer<typeof TemplateSchema>;

/**
 * `GET /templates` query. Admin/supervisor get every template; agents only
 * `approved` + `visibleToAgents` ones whatever they ask for.
 */
export const TemplateListQuerySchema = z.object({
  channelId: z.string().optional(),
  status: TemplateStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export type TemplateListQuery = z.infer<typeof TemplateListQuerySchema>;

/**
 * `GET /templates/groups` item: the same template name across channels (the
 * "Plantillas" section). `multiChannel` = present in more than one channel.
 */
export const TemplateGroupSchema = z.object({
  name: z.string(),
  category: TemplateCategorySchema,
  multiChannel: z.boolean(),
  templates: z.array(
    TemplateSchema.pick({
      id: true,
      channelId: true,
      channelType: true,
      channelName: true,
      language: true,
      status: true,
      visibleToAgents: true,
      syncedAt: true,
    }),
  ),
});
export type TemplateGroup = z.infer<typeof TemplateGroupSchema>;

/**
 * Body of `POST /conversations/:id/template` (and `template` of
 * `POST /conversations/start`). `params` maps `${component}:${key}` to its
 * value; every variable is required (400 `template_params_missing`).
 * Responds with `SendTemplateResultSchema`; the message itself arrives
 * through `conversation:message:broadcast` like any outbound message.
 */
export const SendTemplateSchema = z.object({
  templateId: z.string(),
  params: z.record(z.string(), z.string().trim().min(1).max(1024)).default({}),
  /** Same idempotency key as free-form sends. */
  clientMessageId: z.string().min(1).max(64).optional(),
});
export type SendTemplateInput = z.infer<typeof SendTemplateSchema>;

export const SendTemplateResultSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
});
export type SendTemplateResult = z.infer<typeof SendTemplateResultSchema>;

/** `PATCH /templates/:id/settings` (admin): CRM-side settings only. */
export const UpdateTemplateSettingsSchema = z.object({
  visibleToAgents: z.boolean().optional(),
  /** `${component}:${key}` -> label; an empty string clears the label. */
  variableLabels: z.record(z.string(), z.string().trim().max(60)).optional(),
});
export type UpdateTemplateSettingsInput = z.infer<
  typeof UpdateTemplateSettingsSchema
>;

/**
 * `POST /templates/sync` (admin): pull the channel's templates from the
 * provider and upsert them. Also how a `pending` template gets its fresh
 * status ("Consultar estado"). Templates gone from the provider become
 * `disabled`. 409 `templates_unsupported` for channels without templates.
 */
export const SyncTemplatesSchema = z.object({
  channelId: z.string(),
});
export type SyncTemplatesInput = z.infer<typeof SyncTemplatesSchema>;

export const SyncTemplatesResultSchema = z.object({
  channelId: z.string(),
  total: z.number().int().min(0),
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  disabled: z.number().int().min(0),
  statusChanges: z.array(
    z.object({
      templateId: z.string(),
      name: z.string(),
      language: z.string(),
      from: TemplateStatusSchema.nullable(),
      to: TemplateStatusSchema,
    }),
  ),
  syncedAt: z.coerce.date(),
});
export type SyncTemplatesResult = z.infer<typeof SyncTemplatesResultSchema>;

/** Key of a variable inside `SendTemplateInput.params`. */
export function templateParamKey(
  variable: Pick<TemplateVariable, 'component' | 'key'>,
): string {
  return `${variable.component}:${variable.key}`;
}

/**
 * Fill `{{key}}` placeholders of one component's text. Missing values keep
 * the placeholder, so a preview shows what is still empty. Shared by the
 * preview (front) and the stored message body (API).
 */
export function renderTemplateText(
  text: string,
  component: TemplateComponentType,
  params: Readonly<Record<string, string>>,
): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (placeholder, key: string) => {
    const value = params[`${component}:${key}`];
    return value ? value : placeholder;
  });
}
