// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';

import { ChannelsService } from '../../channels/channels.service';
import { ConversationSendContextService } from '../send-context/conversation-send-context.service';

/**
 * Entry guard of every agent send (socket message, template): a conversation
 * whose channel is not `active` answers `channel_unavailable` before any row
 * is saved, so a broken connection never fills the thread with failures.
 */
@Injectable()
export class ConversationSendGuard {
  constructor(
    private readonly sendContext: ConversationSendContextService,
    private readonly channels: ChannelsService,
  ) {}

  async assertCanSend(conversationId: string): Promise<void> {
    const context = await this.sendContext.get(conversationId);
    // Unknown conversation: the send path answers its own not-found.
    if (!context) return;
    await this.channels.assertSendable(context.channelId);
  }
}
