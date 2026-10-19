// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import {
  type AttachmentType,
  CAPTION_MAX_LENGTH,
  TEXT_MAX_LENGTH,
} from './message.contract';

/**
 * Channel contracts (v2): a company talks to customers through N channels
 * (WhatsApp is the first provider). Replaces `whatsapp_configs`.
 */
export const WHATSAPP_API_VERSIONS = [
  'v18.0',
  'v19.0',
  'v20.0',
  'v21.0',
  'v22.0',
  'v23.0',
] as const;

export const WhatsAppApiVersionSchema = z.enum(WHATSAPP_API_VERSIONS);
export type WhatsAppApiVersion = z.infer<typeof WhatsAppApiVersionSchema>;

export const DEFAULT_WHATSAPP_API_VERSION: WhatsAppApiVersion = 'v22.0';
export const CHANNEL_TYPES = [
  'whatsapp',
  'telegram',
  'messenger',
  'instagram',
  'email',
  'sms',
  'webchat',
] as const;
export const ChannelTypeSchema = z.enum(CHANNEL_TYPES);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;
/** Named channel types (`CHANNEL_TYPE.whatsapp`): never spell the string. */
export const CHANNEL_TYPE = ChannelTypeSchema.enum;

/**
 * `pending`: the channel every company is born with (verify token only, no
 * credentials yet). It turns `active` once it has a phone number ID and an
 * access token; senders and inbound routing only use `active` channels.
 */
export const CHANNEL_STATUSES = [
  'pending',
  'active',
  'inactive',
  'error',
] as const;
export const ChannelStatusSchema = z.enum(CHANNEL_STATUSES);
export type ChannelStatus = z.infer<typeof ChannelStatusSchema>;
/** Named channel statuses (`CHANNEL_STATUS.pending`): never spell the string. */
export const CHANNEL_STATUS = ChannelStatusSchema.enum;

/** Meta's Graph API host (the only one the API ever calls for WhatsApp). */
export const WHATSAPP_GRAPH_BASE_URL = 'https://graph.facebook.com';
/** Route of the WhatsApp webhook controller, relative to the API base URL. */
export const WHATSAPP_WEBHOOK_PATH = 'integration/webhook/whatsapp';
/** Name of a WhatsApp channel created without one. */
export const DEFAULT_WHATSAPP_CHANNEL_NAME = 'WhatsApp';

/** Plaintext keys stored (encrypted) in `channels.credentials` for WhatsApp. */
export const WhatsAppCredentialsSchema = z.object({
  accessToken: z.string(),
  businessId: z.string().optional(),
  /** Meta App Secret: signs every webhook post of this channel's Meta app. */
  appSecret: z.string().optional(),
});
export type WhatsAppCredentials = z.infer<typeof WhatsAppCredentialsSchema>;

/** Non-secret settings stored in `channels.settings` for WhatsApp. */
export const WhatsAppChannelSettingsSchema = z.object({
  apiVersion: z.string().default(DEFAULT_WHATSAPP_API_VERSION),
  apiBaseUrl: z.string().default(WHATSAPP_GRAPH_BASE_URL),
  webhookUrl: z.string().optional(),
});
export type WhatsAppChannelSettings = z.infer<
  typeof WhatsAppChannelSettingsSchema
>;

/** Settings of a new WhatsApp channel (the `pending` one included). */
export const DEFAULT_WHATSAPP_SETTINGS = {
  apiVersion: DEFAULT_WHATSAPP_API_VERSION,
  apiBaseUrl: WHATSAPP_GRAPH_BASE_URL,
} as const satisfies WhatsAppChannelSettings;

/** Meta App Secrets are 32 hex chars (App settings → Basic → App secret). */
export const WhatsAppAppSecretSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{32}$/i, 'validations.appSecret');

/** Payload accepted by `POST /channels` (WhatsApp is the only provider today). */
export const CreateChannelSchema = z.object({
  type: ChannelTypeSchema.default('whatsapp'),
  name: z.string().max(100).optional(),
  externalAccountId: z.string().max(100),
  displayAddress: z.string().max(100).optional(),
  businessId: z.string().optional(),
  accessToken: z.string(),
  webhookUrl: z.string().optional(),
  apiVersion: WhatsAppApiVersionSchema.optional(),
  apiBaseUrl: z.string().optional(),
  webhookVerifyToken: z.string().optional(),
  /**
   * Write-only: stored encrypted with the credentials and never returned
   * (responses only carry `hasAppSecret`).
   */
  appSecret: WhatsAppAppSecretSchema.optional(),
});

export const UpdateChannelSchema = CreateChannelSchema.partial().extend({
  status: ChannelStatusSchema.optional(),
});

/**
 * Sanitized shape returned by the channels endpoints: never includes the
 * access token or the app secret (only whether they are present).
 */
export const ChannelResponseSchema = z.object({
  id: z.string(),
  type: ChannelTypeSchema,
  name: z.string(),
  /** Null while the channel is `pending`. */
  externalAccountId: z.string().nullish(),
  displayAddress: z.string().nullish(),
  status: ChannelStatusSchema,
  webhookVerifyToken: z.string().nullish(),
  apiVersion: z.string().nullish(),
  apiBaseUrl: z.string().nullish(),
  webhookUrl: z.string().nullish(),
  businessId: z.string().nullish(),
  hasCredentials: z.boolean(),
  /** The channel signs its webhooks with its own App Secret. */
  hasAppSecret: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/**
 * `GET /channels/whatsapp/config` only: the settings form needs the stored
 * access token to prefill its (masked) password input. No other endpoint
 * returns it.
 */
export const WhatsAppConfigResponseSchema = ChannelResponseSchema.extend({
  accessToken: z.string().nullish(),
});

export const CONNECTION_CHECK_STATUSES = ['ok', 'failed', 'skipped'] as const;
export const ConnectionCheckStatusSchema = z.enum(CONNECTION_CHECK_STATUSES);
export type ConnectionCheckStatus = z.infer<typeof ConnectionCheckStatusSchema>;
export const CONNECTION_CHECK = ConnectionCheckStatusSchema.enum;

/** One check of the connection test; `message` is user-facing (Spanish). */
export const ConnectionCheckSchema = z.object({
  status: ConnectionCheckStatusSchema,
  message: z.string(),
});
export type ConnectionCheck = z.infer<typeof ConnectionCheckSchema>;

/**
 * `POST /channels/whatsapp/test`: checks the stored channel of the active
 * company. Always answered with 200; each check says what failed.
 */
export const WhatsAppConnectionTestSchema = z.object({
  /** Sending and webhook are `ok` and no check `failed`. */
  ok: z.boolean(),
  /** Phone number ID + access token (+ App Secret) against Graph. */
  sending: ConnectionCheckSchema.extend({
    displayPhoneNumber: z.string().nullish(),
    verifiedName: z.string().nullish(),
  }),
  /** The stored webhook URL answers Meta's verification handshake. */
  webhook: ConnectionCheckSchema.extend({ url: z.string().nullish() }),
  /** The Meta app is subscribed to the WhatsApp Business Account webhooks. */
  subscription: ConnectionCheckSchema,
});
export type WhatsAppConnectionTest = z.infer<
  typeof WhatsAppConnectionTestSchema
>;

export type CreateChannelInput = z.infer<typeof CreateChannelSchema>;
export type UpdateChannelInput = z.infer<typeof UpdateChannelSchema>;
export type ChannelResponse = z.infer<typeof ChannelResponseSchema>;
export type WhatsAppConfigResponse = z.infer<
  typeof WhatsAppConfigResponseSchema
>;

const KB = 1024;
const MB = 1024 * KB;

/** Accepted media types and size cap for one attachment kind. */
export interface MediaRule {
  readonly mimeTypes: readonly string[];
  readonly maxBytes: number;
  /**
   * Only progressive MP4 (one `moov` with the sample tables). Fragmented MP4,
   * what browsers record, is refused by the provider after sending.
   */
  readonly progressiveOnly?: boolean;
}

/**
 * What a channel can send, so the API validates uploads and the composer
 * filters files without asking the server. Adding a channel is one more entry
 * here plus its adapter; nothing else branches on the provider.
 */
export interface ChannelCapabilities {
  /** Sendable kinds; a missing kind cannot be sent on this channel. */
  readonly media: Readonly<Partial<Record<AttachmentType, MediaRule>>>;
  readonly sticker?: {
    readonly width: number;
    readonly height: number;
    readonly maxStaticBytes: number;
    readonly maxAnimatedBytes: number;
  };
  /** Container voice notes must use to render as voice notes. */
  readonly voiceMimeType: string | null;
  readonly textMaxLength: number;
  readonly captionMaxLength: number;
  /** Free-form replies only within this window after the last inbound. */
  readonly replyWindowMs: number | null;
}

/**
 * WhatsApp Cloud API limits.
 * @link https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#supported-media-types
 */
const WHATSAPP_CAPABILITIES: ChannelCapabilities = {
  media: {
    image: { mimeTypes: ['image/jpeg', 'image/png'], maxBytes: 5 * MB },
    video: {
      mimeTypes: ['video/mp4', 'video/3gpp'],
      maxBytes: 16 * MB,
      // Graph answers 131053 ("media file scrutiny failed") to fragmented MP4.
      progressiveOnly: true,
    },
    audio: {
      mimeTypes: [
        'audio/aac',
        'audio/amr',
        'audio/mpeg',
        'audio/mp4',
        'audio/ogg',
      ],
      maxBytes: 16 * MB,
    },
    document: {
      mimeTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain',
        'text/csv',
      ],
      maxBytes: 100 * MB,
    },
    sticker: { mimeTypes: ['image/webp'], maxBytes: 500 * KB },
  },
  sticker: {
    width: 512,
    height: 512,
    maxStaticBytes: 100 * KB,
    maxAnimatedBytes: 500 * KB,
  },
  voiceMimeType: 'audio/ogg',
  textMaxLength: TEXT_MAX_LENGTH,
  captionMaxLength: CAPTION_MAX_LENGTH,
  replyWindowMs: 24 * 60 * 60 * 1000,
};

export const CHANNEL_CAPABILITIES: Readonly<
  Partial<Record<ChannelType, ChannelCapabilities>>
> = {
  whatsapp: WHATSAPP_CAPABILITIES,
};

/** Capabilities of a channel type, or `null` when it cannot send yet. */
export function channelCapabilities(
  type: ChannelType | null | undefined,
): ChannelCapabilities | null {
  return (type && CHANNEL_CAPABILITIES[type]) || null;
}

/** Largest single upload any channel accepts (the upload endpoint cap). */
export const MAX_UPLOAD_BYTES = Math.max(
  ...Object.values(CHANNEL_CAPABILITIES).flatMap((capabilities) =>
    Object.values(capabilities?.media ?? {}).map((rule) => rule.maxBytes),
  ),
);
