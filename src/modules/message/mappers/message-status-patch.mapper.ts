// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ConversationMessageStatusPatch } from '../../../contracts/index';
import type { Message } from '../entities/message.entity';

/**
 * T4/T5: the single mapping from a persisted row to the
 * `conversation:message:status` patch, so webhook transitions and the outbound
 * send transitions push the exact same shape to the thread.
 */
export function toMessageStatusPatch(
  message: Message,
): ConversationMessageStatusPatch {
  return {
    id: message.id,
    conversationId: message.conversationId,
    clientMessageId: message.clientMessageId ?? null,
    status: message.status,
    at: message.statusUpdatedAt ?? new Date(),
    errorCode: message.errorCode ?? null,
    errorMessage: message.errorMessage ?? null,
  };
}
