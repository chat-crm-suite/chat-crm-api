// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  AttachmentStatus,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from '../../contracts/index';

/**
 * `GET /conversations/:id/messages` item + `conversation:message:broadcast`
 * payload (v2). Replaces the legacy `BroadcastDto` from the chats module.
 */
export interface ConversationMessagePayload {
  id: string;
  conversationId: string;
  timestamp: Date;
  status: MessageStatus;
  /**
   * T3: front-generated send id. The broadcast carries it so the optimistic
   * pending row reconciles with the saved row instead of duplicating it.
   */
  clientMessageId?: string | null;
  sender: {
    id: string;
    type: MessageSenderType;
  };
  msg: {
    type: MessageType;
    mediaUrl?: string | null;
    /** T3: pending/ready/failed for rows whose file arrives async. */
    attachmentStatus?: AttachmentStatus | null;
    /** Attachment metadata for the file card (`null` when unknown). */
    mimeType?: string | null;
    sizeBytes?: number | null;
    content: {
      body?: string;
      link?: string;
      caption?: string;
      filename?: string;
    };
  };
}
