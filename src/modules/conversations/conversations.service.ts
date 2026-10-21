// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { In, Repository, UpdateResult } from 'typeorm';

import type {
  AttachmentType,
  ChannelType,
  MessageDirection,
  MessageSenderType,
  MessageType,
} from '../../contracts/index';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import type { TemplateSnapshot } from '../message/entities/message.entity';
import {
  MessageService,
  type SaveMessageParams,
} from '../message/message.service';
import { ConversationAssignmentService } from './assignment/conversation-assignment.service';
import { ConversationAssignmentNotifier } from './assignment/conversation-assignment.notifier';
import { AssignmentOutcome } from './assignment/assignment.types';
import { ConversationRepository } from './conversation.repository';
import type { SaveMessageJob } from './commands/save-conversation-message.command';
import { ConversationAssignment } from './entities/conversation-assignment.entity';
import { Conversation } from './entities/conversation.entity';
import { isReplyWindowClosed } from './listing/conversation-list.service';

interface MessageContentLike {
  body?: string;
  link?: string;
  caption?: string;
  filename?: string;
}

/** Parsed message content accepted by `saveMsg` / `saveOutbound`. */
export interface SaveConversationMessageContent {
  type: MessageType;
  content: MessageContentLike;
  mediaUrl?: string;
  externalId?: string;
  externalMediaId?: string;
  mimeType?: string;
  /** Known file facts (outbound uploads): kept on the attachment row. */
  sizeBytes?: number | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  /** Front-generated send id: makes outbound retries idempotent. */
  clientMessageId?: string | null;
  /** Provider template the message was sent from (`type: 'template'`). */
  templateId?: string | null;
  /** The template as sent (`type: 'template'`). */
  templateSnapshot?: TemplateSnapshot | null;
  /**
   * Attachment kind when the message type does not imply one (a template's
   * header file); media message types derive it themselves.
   */
  attachmentType?: AttachmentType;
}

const ATTACHMENT_TYPE_BY_MESSAGE_TYPE: Partial<
  Record<MessageType, AttachmentType>
> = {
  image: 'image',
  audio: 'audio',
  video: 'video',
  document: 'document',
  sticker: 'sticker',
};

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(ConversationAssignment)
    private readonly assignmentRepo: Repository<ConversationAssignment>,
    @InjectRepository(CompanyMember)
    private readonly members: Repository<CompanyMember>,
    private readonly assignment: ConversationAssignmentService,
    private readonly notifier: ConversationAssignmentNotifier,
    private readonly repository: ConversationRepository,
    private readonly messageService: MessageService,
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Persists a message for a conversation (webhook inbound or socket outbound)
   * through the message module, deriving direction/status/sender from the
   * payload.
   */
  async saveMsg(
    conversationId: string,
    msg: SaveConversationMessageContent,
    sender: { id: string; type: MessageSenderType },
    companyId?: string,
  ) {
    return this.messageService.saveMessage(
      await this.buildMessageParams(conversationId, msg, sender, companyId),
    );
  }

  /**
   * T5: same persist path as `saveMsg`, but reports whether the row is new, so
   * the outbound pipeline sends to Graph exactly once per `clientMessageId`.
   */
  async saveOutbound(
    conversationId: string,
    msg: SaveConversationMessageContent,
    sender: { id: string; type: MessageSenderType },
    companyId?: string,
  ) {
    return this.messageService.saveOutbound(
      await this.buildMessageParams(conversationId, msg, sender, companyId),
    );
  }

  private async buildMessageParams(
    conversationId: string,
    msg: SaveConversationMessageContent,
    sender: { id: string; type: MessageSenderType },
    companyId?: string,
  ): Promise<SaveMessageParams> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      select: { id: true, companyId: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const resolvedCompanyId = companyId ?? conversation.companyId;
    const inbound = sender.type === 'customer';

    const senderMemberId = inbound
      ? null
      : await this.resolveMemberId(sender.id, resolvedCompanyId);

    const link = msg.mediaUrl ?? msg.content?.link;
    const attachmentType =
      ATTACHMENT_TYPE_BY_MESSAGE_TYPE[msg.type] ?? msg.attachmentType;
    // T3: inbound media keeps its reference without a file yet; the async
    // enrichment downloads it and flips the attachment to ready/failed.
    const attachmentStatus =
      inbound && msg.externalMediaId && !link ? 'pending' : 'ready';

    return {
      companyId: resolvedCompanyId,
      conversationId,
      type: msg.type,
      direction: inbound ? 'inbound' : 'outbound',
      senderType: sender.type,
      senderMemberId,
      senderCustomerId: inbound ? sender.id : null,
      body: msg.content?.body ?? msg.content?.caption ?? null,
      externalId: msg.externalId ?? null,
      clientMessageId: msg.clientMessageId ?? null,
      templateId: msg.templateId ?? null,
      templateSnapshot: msg.templateSnapshot ?? null,
      // T5: an outbound row is born pending; Graph's wamid (or the failure)
      // moves it. Inbound rows are already delivered when persisted.
      status: inbound ? 'delivered' : 'pending',
      attachments:
        attachmentType && (link || msg.externalMediaId)
          ? [
              {
                type: attachmentType,
                mimeType: msg.mimeType ?? guessMimeType(msg.content?.filename),
                fileName: msg.content?.filename,
                storageUrl: link,
                externalMediaId: msg.externalMediaId,
                status: attachmentStatus,
                sizeBytes: msg.sizeBytes,
                durationMs: msg.durationMs,
                width: msg.width,
                height: msg.height,
              },
            ]
          : undefined,
    };
  }

  /**
   * Accepts either a member id (pipeline) or a user id (socket) and resolves
   * the company member, or null when there is no membership.
   */
  private async resolveMemberId(
    id: string,
    companyId: string,
  ): Promise<string | null> {
    const byId = await this.members.findOne({
      where: { id, companyId },
      select: { id: true },
    });
    if (byId) return byId.id;

    const byUser = await this.members.findOne({
      where: { userId: id, companyId },
      select: { id: true },
    });
    return byUser?.id ?? null;
  }

  /** Asignación manual/reasignación (admin/supervisor si ya tiene dueño). */
  async assign(
    conversationId: string,
    memberId: string,
    options?: { companyId?: string; requesterId?: string; actorMemberId?: string },
  ): Promise<AssignmentOutcome> {
    const { actorMemberId, ...assignOptions } = options ?? {};
    const outcome = await this.assignment.assignToAgent(
      conversationId,
      memberId,
      assignOptions,
    );

    if (outcome === AssignmentOutcome.ASSIGNED) {
      await this.notifier.notifyAssigned(conversationId, memberId, { actorMemberId });
    }

    return outcome;
  }

  /** Asignación automática al entrar un mensaje + avisos. */
  async ensureAssigned(
    conversationId: string,
    companyId?: string,
  ): Promise<AssignmentOutcome> {
    const outcome = await this.assignment.ensureAssigned(
      conversationId,
      companyId,
    );

    if (outcome === AssignmentOutcome.ASSIGNED) {
      const active = await this.assignment.getActiveAssignment(conversationId);
      if (active?.memberId) {
        await this.notifier.notifyAssigned(conversationId, active.memberId);
      }
    } else if (
      // The conversation stays ownerless: notify supervisors live, both when
      // nobody is available and when auto-assignment is off for the company.
      outcome === AssignmentOutcome.NO_CANDIDATES ||
      outcome === AssignmentOutcome.DISABLED
    ) {
      await this.notifier.notifyUnassigned(conversationId, companyId);
    }

    return outcome;
  }

  /** Reclamo explícito del usuario autenticado (resuelve su member). */
  async claim(
    conversationId: string,
    userId: string,
    companyId?: string,
  ): Promise<AssignmentOutcome> {
    const outcome = await this.assignment.claimForUser(
      conversationId,
      userId,
      companyId,
    );

    if (outcome === AssignmentOutcome.ASSIGNED) {
      const active = await this.assignment.getActiveAssignment(conversationId);
      if (active?.memberId) {
        await this.notifier.notifyAssigned(conversationId, active.memberId, {
          notify: false,
        });
      }
    }

    return outcome;
  }

  /** Reclamo desde el pipeline de mensajes (member id ya resuelto). */
  async claimForMember(
    conversationId: string,
    memberId: string,
    companyId?: string,
  ): Promise<AssignmentOutcome> {
    const outcome = await this.assignment.claimForMember(
      conversationId,
      memberId,
      companyId,
    );

    if (outcome === AssignmentOutcome.ASSIGNED) {
      await this.notifier.notifyAssigned(conversationId, memberId, { notify: false });
    }

    return outcome;
  }

  /** Cola de conversaciones sin asignar de la empresa. */
  listUnassigned(companyId?: string, limit?: number) {
    if (!companyId) return [];
    return this.assignment.listUnassigned(companyId, limit);
  }

  /** Vista "sin respuesta" de la empresa: solo lectura, no reasigna. */
  listNeedsResponse(companyId?: string, minutes?: number) {
    if (!companyId) return [];
    return this.assignment.listNeedsResponse(companyId, minutes);
  }

  /** Lista de conversaciones del member autenticado. */
  async list(userId?: string, companyId?: string) {
    if (!userId || !companyId) return [];

    const member = await this.members.findOne({
      where: { userId, companyId },
      select: { id: true },
    });
    if (!member) return [];

    return this.repository.listForMember(member.id);
  }

  /** Ids of a user's open conversations in the company, newest activity first. */
  async listIdsForUser(userId?: string, companyId?: string): Promise<string[]> {
    const rows = await this.list(userId, companyId);
    return rows.map((row) => row.id);
  }

  /**
   * Refreshes the preview. Only an inbound message changes the lifecycle: it
   * turns `pending`/`closed` back into `open`. An outbound message never
   * touches the status (replying keeps a conversation on hold or resolved).
   */
  async updateLastMessage(
    conversationId: string,
    messageId: string,
    direction: MessageDirection = 'outbound',
  ): Promise<UpdateResult> {
    const at = new Date();
    const result = await this.conversationRepo.update(
      { id: conversationId },
      {
        lastMessageId: messageId,
        lastMessageAt: at,
        ...(direction === 'inbound' ? { lastInboundAt: at } : { lastOutboundAt: at }),
      },
    );
    if (direction === 'inbound') {
      await this.conversationRepo.update(
        { id: conversationId, status: In(['pending', 'closed']) },
        { status: 'open' },
      );
    }

    return result;
  }

  /** Channel + last inbound of a conversation: what the reply window needs. */
  async findReplyWindow(conversationId: string): Promise<{
    companyId: string;
    channelId: string;
    channelType: ChannelType;
    lastInboundAt: Date | null;
  } | null> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      relations: { channel: true },
      withDeleted: true,
      select: {
        id: true,
        companyId: true,
        channelId: true,
        lastInboundAt: true,
        channel: { id: true, type: true },
      },
    });
    if (!conversation?.channel) return null;

    return {
      companyId: conversation.companyId,
      channelId: conversation.channelId,
      channelType: conversation.channel.type,
      lastInboundAt: conversation.lastInboundAt ?? null,
    };
  }

  /** Free-form replies are allowed (no reply window, or still inside it). */
  async isReplyWindowOpen(conversationId: string): Promise<boolean> {
    const window = await this.findReplyWindow(conversationId);
    if (!window) return true;

    return !isReplyWindowClosed(window.channelType, window.lastInboundAt);
  }

  findOne(id: string): Promise<Conversation | null> {
    return this.conversationRepo.findOne({ where: { id } });
  }

  update(_id: string, _dto: SaveMessageJob): Promise<UpdateResult> {
    throw new Error('Not implemented');
  }

  remove(_id: string) {
    return 'This action removes a conversation';
  }
}

function guessMimeType(fileName?: string): string {
  const ext = fileName?.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    case 'mp4':
      return 'video/mp4';
    case 'ogg':
    case 'opus':
      return 'audio/ogg';
    case 'mp3':
      return 'audio/mpeg';
    default:
      return 'application/octet-stream';
  }
}
