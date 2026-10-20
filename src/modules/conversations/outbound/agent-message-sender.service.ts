// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, Optional } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import {
  BILLABLE_SENDS_PAUSED_ERROR,
  ConversationErrorCode,
  type OutgoingMessage,
} from '@contracts';
import type {
  ChannelAdapter,
  ChannelFailure,
  ProviderMedia,
  ResolvedOutgoing,
  ResolvedTemplate,
} from '../../channels/ports/channel-adapter.port';
import { ChannelAdapterRegistry } from '../../channels/ports/channel-adapter.registry';
import type { Message } from '@modules/message/entities/message.entity';
import { toMessageStatusPatch } from '@modules/message/mappers/message-status-patch.mapper';
import { MessageService } from '@modules/message/message.service';
import { SpendService } from '@modules/spend/spend.service';
import type { AgentSendJob } from '../commands/send-conversation-message.command';
import {
  ConversationsService,
  type SaveConversationMessageContent,
} from '../conversations.service';
import { MessageSavedEvent } from '../events/message-saved.event';
import { ConversationFanoutService } from '../realtime/conversation-fanout.service';
import {
  ConversationSendContextService,
  type ConversationSendContext,
} from '../send-context/conversation-send-context.service';
import { toLegacySendError } from './legacy-send-error';
import { OutgoingMediaService, type OutgoingFile } from './outgoing-media.service';
import { SendTimer } from './send-timer';

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
    private readonly media: OutgoingMediaService,
    private readonly eventBus: EventBus,
    private readonly logger: PinoLogger,
    @Optional() private readonly spend?: SpendService,
  ) {
    this.logger.setContext(AgentMessageSender.name);
  }

  async send(
    job: AgentSendJob,
    options?: { attemptsMade?: number },
  ): Promise<Message | null> {
    const timer = new SendTimer(job.receivedAt);
    const result = await this.deliver(job, timer, options?.attemptsMade ?? 0);

    this.logger.info(
      {
        clientMessageId: job.clientMessageId,
        messageId: result?.id,
        type: job.msg.type,
        status: result?.status,
        ...timer.summary(),
      },
      'send.timing',
    );

    return result;
  }

  private async deliver(
    job: AgentSendJob,
    timer: SendTimer,
    attemptsMade: number,
  ): Promise<Message | null> {
    // An expired or foreign upload still leaves a visible (failed) row.
    const prepared = await this.media.prepare(job).then(
      (file) => ({ file, error: null }),
      (error: unknown) => ({ file: null, error: errorMessage(error) }),
    );

    const { message: saved, created } = await this.conversations.saveOutbound(
      job.room,
      toSaveContent(job, prepared.file),
      job.sender,
      job.companyId,
    );
    timer.mark('saved');

    const message = await this.claimSend(saved, {
      created,
      companyId: job.companyId,
      attemptsMade,
    });
    if (!message) return saved;

    return this.dispatch(message, job.msg.type, async ({ adapter, context }) => {
      // WhatsApp-style reply window: outside it only a template reaches the
      // customer, so the provider is never called for free-form content.
      if (!(await this.conversations.isReplyWindowOpen(job.room))) {
        return {
          ...failure('The reply window is closed: send an approved template instead'),
          code: ConversationErrorCode.ReplyWindowClosed,
          replyWindowClosed: true,
        };
      }

      let media: ProviderMedia | null = null;
      if (job.msg.type !== 'text') {
        // A retried row already holds its file, even once the upload expired.
        const attachment = await this.media.attachmentOf(message.id);
        if (!attachment) {
          return failure(prepared.error ?? 'The file of this message is missing');
        }
        const uploaded = await this.media.toProvider(
          adapter,
          { channelId: context.channelId, companyId: context.companyId },
          attachment,
        );
        timer.mark('uploaded');
        if (!uploaded.ok) return uploaded.error;

        media = {
          providerMediaId: uploaded.providerMediaId,
          mimeType: attachment.mimeType,
        };
      }

      return (
        resolveOutgoing(job.msg, media) ??
        failure('The file of this message is missing')
      );
    }, timer);
  }

  /**
   * Provider template send (`POST /conversations/:id/template`, start
   * conversation): same row-first pipeline as free-form messages (saved
   * `pending`, broadcast, then sent once), never subject to the reply window.
   * The row keeps `templateId` and the rendered text as its body.
   */
  async sendTemplate(job: TemplateSendJob): Promise<Message> {
    const timer = new SendTimer(Date.now());
    const { message: saved, created } = await this.conversations.saveOutbound(
      job.conversationId,
      {
        type: 'template',
        content: { body: job.body },
        clientMessageId: job.clientMessageId ?? null,
        templateId: job.templateId,
      },
      { id: job.senderMemberId, type: 'member' },
      job.companyId,
    );

    const message = await this.claimSend(saved, {
      created,
      companyId: job.companyId,
      attemptsMade: 0,
    });
    if (!message) return saved;

    const result = await this.dispatch(
      message,
      'template',
      () => Promise.resolve({ type: 'template' as const, ...job.template }),
      timer,
    );
    this.logger.info(
      { messageId: result.id, templateId: job.templateId, status: result.status, ...timer.summary() },
      'send.template',
    );
    return result;
  }

  /**
   * Shared tail of every send: destination, adapter, billable pause, then
   * the provider call. `resolve` builds the provider-ready message, or
   * answers a failure that keeps the row `failed`.
   */
  private async dispatch(
    message: Message,
    messageType: string,
    resolve: (target: {
      adapter: ChannelAdapter;
      context: ConversationSendContext;
    }) => Promise<ResolvedOutgoing | ChannelFailure>,
    timer: SendTimer,
  ): Promise<Message> {
    // The destination comes from the conversation, never from the client.
    const context = await this.sendContext.get(message.conversationId);
    if (!context?.recipient) {
      return this.failSend(
        message,
        failure('Customer has no address on the conversation channel'),
        messageType,
      );
    }

    const adapter = this.adapters.for(context.channelType);
    if (!adapter) {
      return this.failSend(
        message,
        failure(`No ${context.channelType} adapter is installed`),
        messageType,
      );
    }

    // An admin paused billable sends (budget): free messages still go out.
    if (
      await this.spend?.isBillableSendBlocked(
        context.companyId,
        context.channelType,
        messageType,
      )
    ) {
      return this.failSend(
        message,
        {
          ...failure('Billable sends are paused for this company'),
          code: BILLABLE_SENDS_PAUSED_ERROR,
        },
        messageType,
      );
    }

    const resolved = await resolve({ adapter, context });
    if (!isResolved(resolved)) {
      return this.failSend(message, resolved, messageType, context.recipient);
    }

    const outcome = await adapter.send(
      context.channelId,
      context.recipient,
      resolved,
    );
    timer.mark('delivered');

    if (!outcome.ok) {
      return this.failSend(
        message,
        outcome.error,
        messageType,
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

/** A provider template to send in a conversation, already validated. */
export interface TemplateSendJob {
  conversationId: string;
  companyId: string;
  senderMemberId: string;
  templateId: string;
  /** Rendered text stored as the message body (what the thread shows). */
  body: string;
  template: ResolvedTemplate;
  clientMessageId?: string | null;
}

function isResolved(value: ResolvedOutgoing | ChannelFailure): value is ResolvedOutgoing {
  return 'type' in value;
}

/** What gets persisted for the outgoing message: kind, text and file. */
function toSaveContent(
  job: AgentSendJob,
  file: OutgoingFile | null,
): SaveConversationMessageContent {
  const { msg } = job;
  const body =
    msg.type === 'text'
      ? msg.text
      : 'caption' in msg
        ? msg.caption
        : undefined;

  return {
    type: msg.type,
    content: {
      ...(body ? { body } : {}),
      ...(msg.type === 'document'
        ? { filename: msg.filename }
        : file
          ? { filename: file.filename }
          : {}),
    },
    clientMessageId: job.clientMessageId,
    ...(file
      ? {
          mediaUrl: file.storageUrl,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          durationMs: file.durationMs,
          width: file.width,
          height: file.height,
        }
      : {}),
  };
}

/**
 * The provider-ready message: the outgoing kind with its file referenced by
 * the provider id. `null` when a media kind has no provider file.
 */
function resolveOutgoing(
  msg: OutgoingMessage,
  media: ProviderMedia | null,
): ResolvedOutgoing | null {
  if (msg.type === 'text') return { type: 'text', text: msg.text };
  if (!media) return null;

  switch (msg.type) {
    case 'image':
    case 'video':
      return { type: msg.type, media, caption: msg.caption };
    case 'audio':
      return { type: 'audio', media, voice: msg.voice };
    case 'document':
      return {
        type: 'document',
        media,
        filename: msg.filename,
        caption: msg.caption,
      };
    case 'sticker':
      return { type: 'sticker', media };
  }
}

function failure(message: string): ChannelFailure {
  return { authFault: false, retryable: false, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
