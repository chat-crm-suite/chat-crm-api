// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ConversationMessageDto } from '../../../modules/conversations/dto/conversation-message.dto';

/**
 * Layer 3 of the inbound domain (ticket #20 expand): the persisted and
 * emitted conversation message, in conversation language (room, sender,
 * msg with provider ids). Alias over the existing DTO — zero behavior
 * change, no caller migrates in this ticket.
 */
export type ConversationMessage = ConversationMessageDto;
