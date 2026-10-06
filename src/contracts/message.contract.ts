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
