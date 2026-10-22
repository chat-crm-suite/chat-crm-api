// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, Optional } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import {
  BILLABLE_SENDS_PAUSED_ERROR,
  ConversationErrorCode,
  type OutgoingMessage,
  type TemplateHeaderMedia,
} from '@contracts';
import type {
  ChannelAdapter,
  ChannelFailure,
  ProviderMedia,
  ResolvedOutgoing,
  ResolvedTemplate,
  ResolvedTemplateMedia,
} from '../../channels/ports/channel-adapter.port';
import { ChannelAdapterRegistry } from '../../channels/ports/channel-adapter.registry';
import { ChannelsService } from '../../channels/channels.service';
import type {
  Message,
  TemplateSnapshot,
  TemplateSnapshotMedia,
} from '@modules/message/entities/message.entity';
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
import { uuidv7 } from '@lib/helpers/uuid.helper';
import type { StagedTemplateFile } from '../../templates/templates.service';

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
    private readonly channels: ChannelsService,
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
    const files = await this.prepareTemplateFiles(job);
    const snapshot = withAttachmentIds(job.snapshot, files);

    const { message: saved, created } = await this.conversations.saveOutbound(
      job.conversationId,
      {
        type: 'template',
        content: { body: job.body },
        clientMessageId: job.clientMessageId ?? null,
        templateId: job.templateId,
        templateSnapshot: snapshot,
        attachments: [files.header, ...files.cards].flatMap((slot) =>
          slot?.file
            ? [{ id: slot.id, type: slot.kind, fileName: slot.file.filename, ...attachmentFields(slot.file) }]
            : [],
        ),
      },
      { id: job.senderMemberId, type: 'member' },
      job.companyId,
    );
    timer.mark('saved');

    const message = await this.claimSend(saved, {
      created,
      companyId: job.companyId,
      attemptsMade: 0,
    });
    if (!message) return saved;

    const result = await this.dispatch(
      message,
      'template',
      async ({ adapter, context }) => {
        // The saved row's snapshot names its files (a replay keeps its own).
        const stored = message.templateSnapshot ?? snapshot;
        const refs = [stored.header, ...(stored.cards ?? []).map((card) => card.header)];
        if (!refs.some((ref) => ref?.kind === 'media')) {
          return { type: 'template' as const, ...job.template };
        }

        const attachments = await this.media.attachmentsOf(message.id);
        const target = { channelId: context.channelId, companyId: context.companyId };
        const upload = async (
          ref: TemplateSnapshotMedia,
        ): Promise<ResolvedTemplateMedia | ChannelFailure> => {
          const attachment = ref.attachmentId
            ? attachments.find((item) => item.id === ref.attachmentId)
            : attachments[0];
          if (!attachment) {
            return failure(files.error ?? 'A header file of this template is missing');
          }
          const uploaded = await this.media.toProvider(adapter, target, attachment);
          if (!uploaded.ok) return uploaded.error;
          return {
            type: ref.mediaType,
            media: { providerMediaId: uploaded.providerMediaId, mimeType: attachment.mimeType },
            ...(attachment.fileName ? { filename: attachment.fileName } : {}),
          };
        };

        let headerMedia: ResolvedTemplateMedia | undefined;
        if (stored.header?.kind === 'media') {
          const media = await upload(stored.header);
          if (!isMedia(media)) return media;
          headerMedia = media;
        }
        const cards = [...(job.template.cards ?? [])];
        for (const [index, card] of (stored.cards ?? []).entries()) {
          if (card.header?.kind !== 'media' || !cards[index]) continue;
          const media = await upload(card.header);
          if (!isMedia(media)) return media;
          cards[index] = { ...cards[index], headerMedia: media };
        }
        timer.mark('uploaded');

        return {
          type: 'template' as const,
          ...job.template,
          ...(headerMedia ? { headerMedia } : {}),
          ...(cards.length ? { cards } : {}),
        };
      },
      timer,
    );
    this.logger.info(
      { messageId: result.id, templateId: job.templateId, status: result.status, ...timer.summary() },
      'send.template',
    );
    return result;
  }

  /**
   * Consumes the staged header and card files of a template send, each with
   * a preset attachment id the snapshot points at. An expired upload leaves
   * its slot without a file: the row is still saved, then fails visibly.
   */
  private async prepareTemplateFiles(job: TemplateSendJob): Promise<TemplateFiles> {
    let error: string | null = null;
    const prepare = async (staged: StagedTemplateFile | null | undefined) => {
      if (!staged) return null;
      const file = await this.media
        .prepareTemplateHeader(staged.uploadId, {
          companyId: job.companyId,
          templateId: job.templateId,
          kind: staged.kind,
        })
        .catch((cause: unknown) => {
          error ??= errorMessage(cause);
          return null;
        });
      return { id: uuidv7(), kind: staged.kind, file };
    };

    const header = await prepare(job.headerMedia);
    const cards: TemplateFiles['cards'] = [];
    for (const staged of job.cardMedia ?? []) cards.push(await prepare(staged));
    return { header, cards, error };
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
      // The provider refused the channel itself: mark it down so every inbox
      // shows it and stops sending until an admin fixes the connection.
      if (outcome.error.authFault) {
        await this.channels.markChannelDown(
          context.channelId,
          outcome.error.connectionReason ??
            'El proveedor rechazó las credenciales del canal.',
        );
      }
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
  /** Rendered text stored as the message body (search, list preview). */
  body: string;
  /** The template as sent: how the thread renders it. */
  snapshot: TemplateSnapshot;
  template: ResolvedTemplate;
  /** Staged header file (`POST /templates/:id/header-upload`). */
  headerMedia?: StagedTemplateFile;
  /** Carousel: each card's staged header file (null = none), by card. */
  cardMedia?: Array<StagedTemplateFile | null>;
  clientMessageId?: string | null;
}

/** One staged template file once consumed (`file` null when it expired). */
interface TemplateFileSlot {
  id: string;
  kind: TemplateHeaderMedia;
  file: OutgoingFile | null;
}

interface TemplateFiles {
  header: TemplateFileSlot | null;
  cards: Array<TemplateFileSlot | null>;
  error: string | null;
}

/** The snapshot with each header file pointing at its attachment row. */
function withAttachmentIds(snapshot: TemplateSnapshot, files: TemplateFiles): TemplateSnapshot {
  const link = (
    header: TemplateSnapshotMedia | null,
    slot: TemplateFileSlot | null | undefined,
  ): TemplateSnapshotMedia | null =>
    header && slot ? { ...header, attachmentId: slot.id, filename: slot.file?.filename ?? header.filename } : header;

  return {
    ...snapshot,
    header:
      snapshot.header?.kind === 'media' ? link(snapshot.header, files.header) : snapshot.header,
    ...(snapshot.cards
      ? {
          cards: snapshot.cards.map((card, index) => ({
            ...card,
            header: link(card.header, files.cards[index]),
          })),
        }
      : {}),
  };
}

function isMedia(value: ResolvedTemplateMedia | ChannelFailure): value is ResolvedTemplateMedia {
  return 'media' in value;
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
    ...(file ? fileFields(file) : {}),
  };
}

/** The stored file's facts, kept on the message's attachment row. */
/** A consumed file as an attachment row (template header and card files). */
function attachmentFields(file: OutgoingFile) {
  return {
    storageUrl: file.storageUrl,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    durationMs: file.durationMs,
    width: file.width,
    height: file.height,
  };
}

function fileFields(
  file: OutgoingFile,
): Pick<
  SaveConversationMessageContent,
  'mediaUrl' | 'mimeType' | 'sizeBytes' | 'durationMs' | 'width' | 'height'
> {
  return {
    mediaUrl: file.storageUrl,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    durationMs: file.durationMs,
    width: file.width,
    height: file.height,
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
