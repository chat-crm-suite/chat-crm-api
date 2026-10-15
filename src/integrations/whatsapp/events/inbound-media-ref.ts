// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { AttachmentType } from '@contracts';

/**
 * Correlation clump shared by the inbound media facts, log handlers and
 * metrics subscriber (ticket #24): which saved message, which attachment,
 * which provider media reference and which attachment type. Grouped so the
 * four always travel together and the type stays the bounded
 * `AttachmentType` label, never a free string.
 */
export interface InboundMediaRef {
  messageId: string;
  attachmentId: string;
  mediaId: string;
  type: AttachmentType;
}
