// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { SendConversationMessageInput } from '../../../contracts/index';

/**
 * Internal message payload used by the queue (`save-message`): the wire shape
 * minus `to` (the conversation is `room`), plus the optional `mediaUrl`
 * produced by the upload flow.
 */
export interface ConversationMessageDto
  extends Omit<SendConversationMessageInput, 'msg' | 'to'> {
  msg: SendConversationMessageInput['msg'] & {
    mediaUrl?: string;
    /** Provider message id (wamid) for inbound messages. */
    externalId?: string;
    /** Provider media id (Meta media reference) for inbound attachments. */
    externalMediaId?: string;
    /** Provider-reported MIME type for inbound attachments. */
    mimeType?: string;
  };
}
