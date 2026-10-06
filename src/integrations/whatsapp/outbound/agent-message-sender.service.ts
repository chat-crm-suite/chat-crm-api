// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { getMessageStrategy } from '../../../modules/message/strategies/strategy.registry';
import { toMessageStatusPatch } from '../../../modules/message/mappers/message-status-patch.mapper';
import type { Message } from '../../../modules/message/entities/message.entity';
import { MessageService } from '../../../modules/message/message.service';
import { ConversationsService } from '../../../modules/conversations/conversations.service';
import { MessageSavedEvent } from '../../../modules/conversations/events/message-saved.event';
import { ConversationFanoutService } from '../../../modules/conversations/realtime/conversation-fanout.service';
import { SendConversationMessageDto } from '../../../modules/conversations/dto/send-conversation-message.dto';
import type { WhatsAppPayload } from '../interfaces/whatsapp-message.interface';
import type { WhatsAppErrorInfo } from '../clients/whatsapp.client';
import { toLegacyWhatsAppError } from '../legacy-error';
import { WhatsAppService } from '../whatsapp.service';

/**
 * T5 outbound pipeline: an agent send is persisted first as `pending`
 * (idempotent by `client_message_id`) and broadcast immediately; only Graph's
 * answer carries the wamid that moves the row to `sent`, and the T4 delivery
 * states move it from there. Failures persist on the row instead of vanishing.
 *
 * #8: a user retry of a `failed` row resets it to `pending` through an atomic
 * compare-and-set before Graph is called again; concurrent retries cannot
 * double-send.
 */
@Injectable()
export class AgentMessageSender {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: MessageService,
    private readonly whatsapp: WhatsAppService,
    private readonly fanout: ConversationFanoutService,
    private readonly eventBus: EventBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AgentMessageSender.name);
  }

  async send(
    data: SendConversationMessageDto,
    options?: { attemptsMade?: number },
  ): Promise<Message | null> {
    const attemptsMade = options?.attemptsMade ?? 0;
    const { message: saved, created } = await this.conversations.saveOutbound(
      data.room,
      { ...data.msg, clientMessageId: data.clientMessageId ?? null },
      data.sender,
      data.companyId,
    );
    let message = saved;

    if (!created) {
      if (message.status === 'failed') {
        // #8 user-initiated retry: only the atomic winner flips the row back
        // to pending and owns the new Graph call; a concurrent retry loses the
        // compare-and-set and falls into the duplicate guard.
        const reset = await this.messages.resetFailedForRetry(message.id);
        if (!reset) {
          this.logger.debug(
            {
              messageId: message.id,
              clientMessageId: message.clientMessageId,
            },
            'Duplicate client message id ignored',
          );
          return message;
        }

        message = reset;
        this.logger.warn(
          {
            messageId: message.id,
            clientMessageId: message.clientMessageId,
          },
          'Retrying a failed outbound send',
        );
        // The row goes back to pending before Graph is called, so every open
        // thread sees the retry, not just the client that triggered it.
        await this.fanout.emitStatusPatch(toMessageStatusPatch(message));
      } else if (attemptsMade === 0 || message.status !== 'pending') {
        // A double submit (same client id) returns the existing row: the first
        // submit already broadcast it and owns the Graph send.
        this.logger.debug(
          {
            messageId: message.id,
            clientMessageId: message.clientMessageId,
          },
          'Duplicate client message id ignored',
        );
        return message;
      } else {
        // A stalled BullMQ retry is not a duplicate: the original attempt died
        // before Graph answered, so a still-pending row is ours to send.
        this.logger.warn(
          {
            messageId: message.id,
            clientMessageId: message.clientMessageId,
            attemptsMade,
          },
          'Retrying a stalled outbound send over the pending row',
        );
      }
    } else {
      // Same live path as any saved message: the pending row reaches the
      // thread before Graph is even called.
      await this.eventBus.publish(
        new MessageSavedEvent(message, data.companyId),
      );
    }

    let payload: WhatsAppPayload;
    try {
      payload = getMessageStrategy(data.msg.type).toWhatsAppPayload(
        data.to,
        data.msg.content,
      );
    } catch (error: unknown) {
      // A type the provider cannot build must not leave the row stuck
      // pending: the thread gets a visible failure.
      return this.failSend(
        message,
        {
          authFault: false,
          retryable: false,
          message: error instanceof Error ? error.message : String(error),
        },
        data.msg.type,
        data.to,
      );
    }

    const outcome = await this.whatsapp.deliverMessage(payload, data.companyId);

    if (!outcome.ok) {
      return this.failSend(message, outcome.error, data.msg.type, data.to);
    }

    const wamid = outcome.response?.messages?.[0]?.id;
    if (!wamid) {
      return this.failSend(
        message,
        {
          authFault: false,
          retryable: false,
          message: 'WhatsApp send answered without a wamid',
        },
        data.msg.type,
        data.to,
      );
    }

    const sent = await this.messages.markSent(message.id, wamid);
    if (sent) {
      await this.fanout.emitStatusPatch(toMessageStatusPatch(sent));
    }

    return sent ?? message;
  }

  /**
   * The row stays in the thread as `failed` with the provider error; the live
   * patch and the legacy error event carry the same failure. The recipient is
   * the send destination, so a 24h-window failure can offer the template
   * action with the phone to reuse (#9).
   */
  private async failSend(
    message: Message,
    error: WhatsAppErrorInfo,
    messageType: string,
    recipient?: string,
  ): Promise<Message> {
    this.logger.error({ error, messageId: message.id }, 'WhatsApp send failed');

    const failed = await this.messages.markSendFailed(message.id, {
      code: error.code ?? null,
      message: error.message ?? null,
    });

    if (failed) {
      await this.fanout.emitStatusPatch(toMessageStatusPatch(failed));
      await this.fanout.emitError(
        failed.conversationId,
        toLegacyWhatsAppError(error, messageType, recipient),
      );
    }

    return failed ?? message;
  }
}
