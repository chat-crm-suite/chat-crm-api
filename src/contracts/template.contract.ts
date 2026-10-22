// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import {
  type ChannelType,
  ChannelTypeSchema,
  channelCapabilities,
} from './channel.contract';
import {
  StagedUploadSchema,
  TemplateButtonSchema,
  TEMPLATE_HEADER_MEDIA,
  type TemplateHeaderMedia,
  TemplateHeaderMediaSchema,
} from './message.contract';

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
  /** Swipeable cards (`cards`), each with its own header file. */
  'carousel',
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

/**
 * One card of a `carousel` component. Its body placeholders and dynamic URL
 * buttons are variables of component `carousel` keyed by card
 * (`templateCardParamKey`).
 */
export const TemplateCardSchema = z.object({
  headerFormat: TemplateHeaderFormatSchema.nullable(),
  body: z.string().nullable(),
  buttons: z.array(TemplateButtonSchema),
});
export type TemplateCard = z.infer<typeof TemplateCardSchema>;

/** Most cards a carousel can carry (also bounds `SendTemplateSchema.cards`). */
export const TEMPLATE_CAROUSEL_MAX_CARDS = 10;

/**
 * Why a template cannot be sent from the CRM (yet): a carousel on a channel
 * without carousels, a location header, or a header file kind the channel
 * does not accept.
 */
export const TEMPLATE_UNSENDABLE_REASONS = [
  'carousel',
  'location_header',
  'header_media_unsupported',
] as const;
export const TemplateUnsendableReasonSchema = z.enum(TEMPLATE_UNSENDABLE_REASONS);
export type TemplateUnsendableReason = z.infer<typeof TemplateUnsendableReasonSchema>;

export const TemplateSendSupportSchema = z.object({
  ok: z.boolean(),
  /** Null when `ok`. */
  reason: TemplateUnsendableReasonSchema.nullable(),
});
export type TemplateSendSupport = z.infer<typeof TemplateSendSupportSchema>;

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
  /** `type: 'carousel'` only. */
  cards: z.array(TemplateCardSchema).nullish(),
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
  /**
   * File the header needs at send time (`SendTemplateSchema.headerMedia`),
   * or null for a text/no header.
   */
  headerMedia: TemplateHeaderMediaSchema.nullable(),
  /** Whether the CRM can send it on its channel, and why not. */
  sendSupport: TemplateSendSupportSchema,
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
 * A template with `headerMedia` also needs its file (400
 * `template_header_media_missing` / `template_header_media_mismatch`); one
 * with `sendSupport.ok === false` answers 409 `template_unsendable`.
 * Responds with `SendTemplateResultSchema`; the message itself arrives
 * through `conversation:message:broadcast` like any outbound message.
 */
export const SendTemplateSchema = z.object({
  templateId: z.string(),
  params: z.record(z.string(), z.string().trim().min(1).max(1024)).default({}),
  /** The header file, staged by `POST /templates/:id/header-upload`. */
  headerMedia: z.object({ uploadId: z.uuid() }).optional(),
  /**
   * Carousel templates: one entry per card, in card order. A card whose
   * header takes a file carries it, staged with `?card=<index>`.
   */
  cards: z
    .array(z.object({ headerMedia: z.object({ uploadId: z.uuid() }).optional() }))
    .max(TEMPLATE_CAROUSEL_MAX_CARDS)
    .optional(),
  /** Same idempotency key as free-form sends. */
  clientMessageId: z.string().min(1).max(64).optional(),
});
export type SendTemplateInput = z.infer<typeof SendTemplateSchema>;

/**
 * `POST /templates/:id/header-upload` (multipart `file`): stages the header
 * file of a template before sending it, in a conversation or when starting
 * one. The kind is the template's `headerMedia`; the file follows the
 * channel's upload rules (same `UPLOAD_ERROR_CODES` as message uploads).
 * 409 `template_header_media_not_needed` when the header takes no file.
 */
export const TemplateHeaderUploadResultSchema = StagedUploadSchema;

/** `POST /templates/:id/header-upload` query: `card` targets a carousel card. */
export const TemplateHeaderUploadQuerySchema = z.object({
  card: z.coerce.number().int().min(0).max(TEMPLATE_CAROUSEL_MAX_CARDS - 1).optional(),
});
export type TemplateHeaderUploadQuery = z.infer<typeof TemplateHeaderUploadQuerySchema>;
export type TemplateHeaderUploadResult = z.infer<typeof TemplateHeaderUploadResultSchema>;

export const SendTemplateResultSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
});
export type SendTemplateResult = z.infer<typeof SendTemplateResultSchema>;

/**
 * `PATCH /templates/:id/settings` (admin): CRM-side settings only. Responds
 * with the updated `TemplateSchema`.
 */
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

/** The file a template's header needs at send time, or null. */
export function templateHeaderMedia(
  components: readonly TemplateComponent[],
): TemplateHeaderMedia | null {
  return asHeaderMedia(components.find((component) => component.type === 'header')?.format);
}

/**
 * Whether the CRM can send a template on a channel type. Shared by the API
 * (refuses the send) and the app (disables the template with the reason).
 */
export function templateSendSupport(
  components: readonly TemplateComponent[],
  channelType: ChannelType,
): TemplateSendSupport {
  const unsendable = (reason: TemplateUnsendableReason) => ({ ok: false, reason });
  const capabilities = channelCapabilities(channelType);
  const cards = templateCards(components);
  // No cards = stored before cards were kept: unsendable until re-synced.
  if (
    components.some((component) => component.type === 'carousel') &&
    (!capabilities?.templateCarousel ||
      !cards.length ||
      cards.length > capabilities.templateCarousel.maxCards)
  ) {
    return unsendable('carousel');
  }

  const header = components.find((component) => component.type === 'header');
  const formats = [header?.format, ...cards.map((card) => card.headerFormat)];
  if (formats.includes('location')) return unsendable('location_header');

  const media = [templateHeaderMedia(components), ...templateCardMedia(components)];
  const accepted = (kind: TemplateHeaderMedia | null) =>
    !kind || (capabilities?.templateHeaderMedia.includes(kind) && !!capabilities.media[kind]);
  if (!media.every(accepted)) return unsendable('header_media_unsupported');

  return { ok: true, reason: null };
}

/** The cards of a carousel template, or none. */
export function templateCards(components: readonly TemplateComponent[]): TemplateCard[] {
  return components.find((component) => component.type === 'carousel')?.cards ?? [];
}

/** The file each carousel card's header needs (null = no file), by card. */
export function templateCardMedia(
  components: readonly TemplateComponent[],
): Array<TemplateHeaderMedia | null> {
  return templateCards(components).map((card) => asHeaderMedia(card.headerFormat));
}

/**
 * Key of a card variable: `${card}.body.${placeholder}` for the card body,
 * `${card}.button.${index}` for a dynamic URL button (component `carousel`).
 */
export function templateCardVariableKey(
  card: number,
  part: 'body' | 'button',
  key: string | number,
): string {
  return `${card}.${part}.${key}`;
}

/** Fill a card body's `{{key}}` placeholders (missing values keep them). */
export function renderTemplateCardText(
  text: string,
  card: number,
  params: Readonly<Record<string, string>>,
): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (placeholder, key: string) => {
    const value =
      params[templateParamKey({ component: 'carousel', key: templateCardVariableKey(card, 'body', key) })];
    return value ? value : placeholder;
  });
}

function asHeaderMedia(format: string | null | undefined): TemplateHeaderMedia | null {
  return (TEMPLATE_HEADER_MEDIA as readonly string[]).includes(format ?? '')
    ? (format as TemplateHeaderMedia)
    : null;
}

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
