// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

/**
 * Message domain values (v2). Single source of truth, shared with the
 * frontend; the DB columns are varchar(50) validated by these schemas.
 */
export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export const MessageDirectionSchema = z.enum(MESSAGE_DIRECTIONS);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

export const MESSAGE_SENDER_TYPES = [
  'customer',
  'member',
  'system',
  'bot',
] as const;
export const MessageSenderTypeSchema = z.enum(MESSAGE_SENDER_TYPES);
export type MessageSenderType = z.infer<typeof MessageSenderTypeSchema>;

export const MESSAGE_TYPES = [
  'text',
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'location',
  'contact',
  'template',
  'interactive',
  'reaction',
] as const;
export const MessageTypeSchema = z.enum(MESSAGE_TYPES);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const MESSAGE_STATUSES = [
  'pending',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;
export const MessageStatusSchema = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const ATTACHMENT_TYPES = [
  'image',
  'audio',
  'video',
  'document',
  'sticker',
] as const;
export const AttachmentTypeSchema = z.enum(ATTACHMENT_TYPES);
export type AttachmentType = z.infer<typeof AttachmentTypeSchema>;

/**
 * Attachment lifecycle (T3): inbound media is born `pending` (the row is
 * already visible) and the async enrichment moves it to `ready` or `failed`.
 * Uploaded/outbound files are `ready` from the start.
 */
export const ATTACHMENT_STATUSES = ['pending', 'ready', 'failed'] as const;
export const AttachmentStatusSchema = z.enum(ATTACHMENT_STATUSES);
export type AttachmentStatus = z.infer<typeof AttachmentStatusSchema>;

/**
 * Channel-agnostic message model (v3). The send payload and the read model
 * are discriminated unions on `type`, so every consumer narrows by type and
 * the compiler flags any kind it forgets to handle. Provider shapes (Graph,
 * Telegram…) never leak into these schemas: each channel adapter maps them.
 */
export const TEXT_MAX_LENGTH = 4096;
export const CAPTION_MAX_LENGTH = 1024;
export const FILENAME_MAX_LENGTH = 240;

const UploadIdSchema = z.uuid();
const CaptionSchema = z.string().trim().min(1).max(CAPTION_MAX_LENGTH);
const FilenameSchema = z.string().trim().min(1).max(FILENAME_MAX_LENGTH);

/** A file staged by `POST /conversations/:id/uploads`, or a stored one. */
export const StickerSourceSchema = z.union([
  z.object({ uploadId: UploadIdSchema }),
  /** Re-send a sticker the company already stores (e.g. one received). */
  z.object({ attachmentId: z.string().min(1) }),
]);
export type StickerSource = z.infer<typeof StickerSourceSchema>;

/** What an agent sends (`conversation:message:send` → `msg`). */
export const OutgoingMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string().trim().min(1).max(TEXT_MAX_LENGTH),
  }),
  z.object({
    type: z.literal('image'),
    uploadId: UploadIdSchema,
    caption: CaptionSchema.optional(),
  }),
  z.object({
    type: z.literal('video'),
    uploadId: UploadIdSchema,
    caption: CaptionSchema.optional(),
  }),
  z.object({
    type: z.literal('audio'),
    uploadId: UploadIdSchema,
    /** Recorded voice note (push-to-talk) rather than an audio file. */
    voice: z.boolean(),
  }),
  z.object({
    type: z.literal('document'),
    uploadId: UploadIdSchema,
    filename: FilenameSchema,
    caption: CaptionSchema.optional(),
  }),
  z.object({
    type: z.literal('sticker'),
    source: StickerSourceSchema,
  }),
]);
export type OutgoingMessage = z.infer<typeof OutgoingMessageSchema>;
export type OutgoingMessageType = OutgoingMessage['type'];

/**
 * The file behind a media message. `url` is our membership-checked
 * `/attachments/:id` endpoint (never a provider link) and stays `null` while
 * the file is `pending` or once it `failed`.
 */
export const MediaRefSchema = z.object({
  attachmentId: z.string().nullable(),
  url: z.string().nullable(),
  status: AttachmentStatusSchema,
  mimeType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  durationMs: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

/** How a message renders (REST history and socket broadcast). */
export const MessageViewSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image'),
    media: MediaRefSchema,
    caption: z.string().nullable(),
  }),
  z.object({
    type: z.literal('video'),
    media: MediaRefSchema,
    caption: z.string().nullable(),
  }),
  z.object({
    type: z.literal('audio'),
    media: MediaRefSchema,
    voice: z.boolean(),
  }),
  z.object({
    type: z.literal('document'),
    media: MediaRefSchema,
    filename: z.string().nullable(),
    caption: z.string().nullable(),
  }),
  z.object({ type: z.literal('sticker'), media: MediaRefSchema }),
  /**
   * Kinds the product does not render yet (location, contact, template,
   * interactive, reaction): the original type plus any text it carried.
   */
  z.object({
    type: z.literal('unsupported'),
    originalType: MessageTypeSchema,
    text: z.string().nullable(),
  }),
]);
export type MessageView = z.infer<typeof MessageViewSchema>;
export type MessageViewType = MessageView['type'];
export type MediaMessageView = Extract<MessageView, { media: MediaRef }>;

/** One conversation message: `GET /conversations/:id/messages` item. */
export const ConversationMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  /** Front-generated send id; reconciles the optimistic row with this one. */
  clientMessageId: z.string().nullable(),
  timestamp: z.coerce.date(),
  status: MessageStatusSchema,
  sender: z.object({
    id: z.string(),
    type: MessageSenderTypeSchema,
  }),
  msg: MessageViewSchema,
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

/**
 * `POST /conversations/:id/uploads` multipart fields (besides `file`). The
 * kind is the sender's intent: a png can go as an image or as a document.
 */
export const StageUploadSchema = z.object({
  kind: AttachmentTypeSchema,
  /** Duration measured by the client recorder (audio/video), if known. */
  durationMs: z.coerce.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
});
export type StageUploadInput = z.infer<typeof StageUploadSchema>;

/**
 * Why `POST /conversations/:id/uploads` refused a file (`code` of the error
 * body), so the app can explain it in the agent's language.
 */
export const UPLOAD_ERROR_CODES = [
  'channel_unsupported',
  'content_mismatch',
  'type_not_allowed',
  'too_large',
  'sticker_dimensions',
  'sticker_too_large',
  'fragmented_video',
  'unreadable',
] as const;
export const UploadErrorCodeSchema = z.enum(UPLOAD_ERROR_CODES);
export type UploadErrorCode = z.infer<typeof UploadErrorCodeSchema>;

/** `POST /conversations/:id/uploads` answer: a file ready to be sent. */
export const StagedUploadSchema = z.object({
  uploadId: UploadIdSchema,
  kind: AttachmentTypeSchema,
  mimeType: z.string(),
  sizeBytes: z.number(),
  filename: z.string(),
  durationMs: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  /** The staged file is discarded after this instant if never sent. */
  expiresAt: z.coerce.date(),
});
export type StagedUpload = z.infer<typeof StagedUploadSchema>;

export const SEND_MESSAGE_ERROR_CODES = [
  'validation',
  'forbidden',
  'not_found',
  'internal',
] as const;
export const SendMessageErrorCodeSchema = z.enum(SEND_MESSAGE_ERROR_CODES);
export type SendMessageErrorCode = z.infer<typeof SendMessageErrorCodeSchema>;

/**
 * Acknowledgement of `conversation:message:send`. `ok` means the send is
 * durably queued (the provider outcome arrives later as a status patch).
 */
export const SendMessageAckSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    code: SendMessageErrorCodeSchema,
    message: z.string(),
  }),
]);
export type SendMessageAck = z.infer<typeof SendMessageAckSchema>;
