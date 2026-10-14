// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import type { OutgoingMessage } from '@contracts';
import type {
  ChannelFailure,
  ResolvedOutgoing,
} from '@modules/channels/ports/channel-adapter.port';
import { ChannelAdapterRegistry } from '@modules/channels/ports/channel-adapter.registry';
import type { Message } from '@modules/message/entities/message.entity';
import { toMessageStatusPatch } from '@modules/message/mappers/message-status-patch.mapper';
import { MessageService } from '@modules/message/message.service';
import type { AgentSendJob } from '../commands/send-conversation-message.command';
import {
  ConversationsService,
  type SaveConversationMessageContent,
} from '../conversations.service';
import { MessageSavedEvent } from '../events/message-saved.event';
import { ConversationFanoutService } from '../realtime/conversation-fanout.service';
import { ConversationSendContextService } from '../send-context/conversation-send-context.service';
import { toLegacySendError } from './legacy-send-error';

/**
 * Channel-agnostic outbound pipeline (T5). An agent send is persisted first
 * as `pending` (idempotent by `client_message_id`) and broadcast at once;
 * only the provider's answer moves it to `sent` (or `failed`, persisted on
 * the row). The provider is reached through the channel adapter of the
 * conversation's channel, so this class never sees a provider payload.
 *
 * #8: a user retry of a `failed` row resets it to `pending` through an atomic
 * compare-and-set before the provider is called again; concurrent retries
 * cannot double-send.
 */
@Injectable()
export class AgentMessageSender {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: MessageService,
    private readonly fanout: ConversationFanoutService,
    private readonly sendContext: ConversationSendContextService,
    private readonly adapters: ChannelAdapterRegistry,
    private readonly eventBus: EventBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AgentMessageSender.name);
  }

  async send(
    job: AgentSendJob,
    options?: { attemptsMade?: number },
  ): Promise<Message | null> {
    const { message: saved, created } = await this.conversations.saveOutbound(
      job.room,
      toSaveContent(job),
      job.sender,
      job.companyId,
    );

    const message = await this.claimSend(saved, {
      created,
      companyId: job.companyId,
      attemptsMade: options?.attemptsMade ?? 0,
    });
    if (!message) return saved;

    // The destination comes from the conversation, never from the client.
    const context = await this.sendContext.get(job.room);
    if (!context?.recipient) {
      return this.failSend(
        message,
        failure('Customer has no address on the conversation channel'),
        job.msg.type,
      );
    }

    const adapter = this.adapters.for(context.channelType);
    if (!adapter) {
      return this.failSend(
        message,
        failure(`No ${context.channelType} adapter is installed`),
        job.msg.type,
      );
    }

    const resolved = resolveOutgoing(job.msg);
    if (!resolved) {
      return this.failSend(
        message,
        failure(`Sending ${job.msg.type} messages is not available yet`),
        job.msg.type,
      );
    }

    const outcome = await adapter.send(
      context.channelId,
      context.recipient,
      resolved,
    );
    if (!outcome.ok) {
      return this.failSend(
        message,
        outcome.error,
        job.msg.type,
        context.recipient,
      );
    }

    const sent = await this.messages.markSent(message.id, outcome.externalId);
    if (sent) await this.fanout.emitStatusPatch(toMessageStatusPatch(sent));

    return sent ?? message;
  }

  /**
   * Decides whether this run owns the provider call for the saved row, and
   * returns the row to send (or `null` for a duplicate that must not send).
   */
  private async claimSend(
    message: Message,
    run: { created: boolean; companyId: string; attemptsMade: number },
  ): Promise<Message | null> {
    const ref = {
      messageId: message.id,
      clientMessageId: message.clientMessageId,
    };

    if (run.created) {
      // Same live path as any saved message: the pending row reaches the
      // thread before the provider is even called.
      await this.eventBus.publish(new MessageSavedEvent(message, run.companyId));
      return message;
    }

    if (message.status === 'failed') {
      // #8 user-initiated retry: only the atomic winner flips the row back to
      // pending and owns the new provider call.
      const reset = await this.messages.resetFailedForRetry(message.id);
      if (!reset) {
        this.logger.debug(ref, 'Duplicate client message id ignored');
        return null;
      }

      this.logger.warn(ref, 'Retrying a failed outbound send');
      // Back to pending before the provider is called, so every open thread
      // sees the retry, not just the client that triggered it.
      await this.fanout.emitStatusPatch(toMessageStatusPatch(reset));
      return reset;
    }

    if (run.attemptsMade === 0 || message.status !== 'pending') {
      // A double submit (same client id) returns the existing row: the first
      // submit already broadcast it and owns the provider call.
      this.logger.debug(ref, 'Duplicate client message id ignored');
      return null;
    }

    // A stalled BullMQ retry is not a duplicate: the original attempt died
    // before the provider answered, so a still-pending row is ours to send.
    this.logger.warn(
      { ...ref, attemptsMade: run.attemptsMade },
      'Retrying a stalled outbound send over the pending row',
    );
    return message;
  }

  /**
   * The row stays in the thread as `failed` with the provider error; the live
   * patch and the legacy error event carry the same failure. The recipient
   * travels with a closed-window failure so the app can offer a template.
   */
  private async failSend(
    message: Message,
    error: ChannelFailure,
    messageType: string,
    recipient?: string,
  ): Promise<Message> {
    this.logger.error({ error, messageId: message.id }, 'Outbound send failed');

    const failed = await this.messages.markSendFailed(message.id, {
      code: error.code ?? null,
      message: error.message ?? null,
    });

    if (failed) {
      await this.fanout.emitStatusPatch(toMessageStatusPatch(failed));
      await this.fanout.emitError(
        failed.conversationId,
        toLegacySendError(error, messageType, recipient),
      );
    }

    return failed ?? message;
  }
}

/** What gets persisted for the outgoing message (body + kind). */
function toSaveContent(job: AgentSendJob): SaveConversationMessageContent {
  const { msg } = job;

  return {
    type: msg.type,
    content: msg.type === 'text' ? { body: msg.text } : {},
    clientMessageId: job.clientMessageId,
  };
}

/**
 * The provider-ready message, or `null` for kinds whose files are not wired
 * to the provider yet.
 */
function resolveOutgoing(msg: OutgoingMessage): ResolvedOutgoing | null {
  return msg.type === 'text' ? { type: 'text', text: msg.text } : null;
}

function failure(message: string): ChannelFailure {
  return { authFault: false, retryable: false, message };
}
