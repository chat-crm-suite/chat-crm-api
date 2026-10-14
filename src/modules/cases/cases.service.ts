// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, IsNull, Repository } from 'typeorm';

import { REOPEN_WINDOW_HOURS } from '../../contracts/index';
import { isDuplicateKeyError } from '../../lib/helpers/query-error.helper';
import { Conversation } from '../conversations/entities/conversation.entity';
import type { Message } from '../message/entities/message.entity';
import { CaseReply } from './entities/case-reply.entity';
import { Case } from './entities/case.entity';

const REOPEN_WINDOW_MS = REOPEN_WINDOW_HOURS * 3600 * 1000;

/**
 * Support-case lifecycle, driven by the saved-message stream:
 *
 * - inbound message, no open case → a case opens (a reopen when the previous
 *   one closed less than `REOPEN_WINDOW_HOURS` ago); the first unanswered
 *   inbound starts the "awaiting reply" clock.
 * - member message on an open case → answers the pending burst (one
 *   `case_replies` row; the first one is the case's first response).
 * - explicit close → `closed`, with the current assignee as owner.
 *
 * Every write is a conditional update, so concurrent messages cannot open two
 * cases (unique `open_key`) or double-answer a burst.
 */
@Injectable()
export class CasesService {
  constructor(
    @InjectRepository(Case) private readonly cases: Repository<Case>,
    @InjectRepository(CaseReply) private readonly replies: Repository<CaseReply>,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CasesService.name);
  }

  /** The open case of a conversation, or null. */
  findOpen(conversationId: string): Promise<Case | null> {
    return this.cases.findOne({ where: { openKey: conversationId } });
  }

  /** Latest case of the conversation (open or closed), or null. */
  findLatest(conversationId: string): Promise<Case | null> {
    return this.cases.findOne({
      where: { conversationId },
      order: { openedAt: 'DESC', id: 'DESC' },
    });
  }

  /** Inbound customer message: open (or continue) the case. */
  async recordInbound(message: Message): Promise<Case | null> {
    const at = message.createdAt ?? new Date();
    const open = (await this.findOpen(message.conversationId)) ?? (await this.open(message, at));
    if (!open) return null;

    await this.cases.increment({ id: open.id }, 'inboundCount', 1);
    // Only the first message of an unanswered burst starts the clock.
    await this.cases.update(
      { id: open.id, awaitingReplySince: IsNull() },
      { awaitingReplySince: at },
    );

    return open;
  }

  /**
   * Member message: answers the pending burst of the open case. Messages
   * without an open case (agent-initiated threads) are not measured.
   */
  async recordOutbound(message: Message): Promise<Case | null> {
    if (message.senderType !== 'member') return null;

    const open = await this.findOpen(message.conversationId);
    if (!open) return null;

    const at = message.createdAt ?? new Date();
    await this.cases.increment({ id: open.id }, 'outboundCount', 1);

    const awaitedFrom = open.awaitingReplySince;
    if (!awaitedFrom) return open;

    // Conditional on the burst we read: a concurrent reply loses the race.
    const answered = await this.cases.update(
      { id: open.id, awaitingReplySince: awaitedFrom },
      { awaitingReplySince: null },
    );
    if (!answered.affected) return open;

    const isFirst = !open.firstResponseAt;
    await this.replies.save(
      this.replies.create({
        companyId: open.companyId,
        caseId: open.id,
        memberId: message.senderMemberId ?? null,
        awaitedFrom,
        repliedAt: at,
        isFirst,
      }),
    );

    if (isFirst) {
      await this.cases.update(
        { id: open.id, firstResponseAt: IsNull() },
        {
          firstResponseAt: at,
          firstResponderMemberId: message.senderMemberId ?? null,
        },
      );
    }

    return open;
  }

  /**
   * Closes the open case of the conversation; the owner is the assignee at
   * this moment (else whoever closes it). 409 when nothing is open.
   */
  async close(
    conversationId: string,
    memberId: string | null,
    note?: string,
  ): Promise<Case> {
    const open = await this.findOpen(conversationId);
    if (!open) {
      throw new ConflictException('The conversation has no open case');
    }

    const conversation = await this.dataSource.getRepository(Conversation).findOne({
      where: { id: conversationId },
      select: { id: true, assignedMemberId: true },
    });

    const closedAt = new Date();
    const result = await this.cases.update(
      { id: open.id, openKey: conversationId },
      {
        status: 'closed',
        openKey: null,
        closedAt,
        closedByMemberId: memberId,
        ownerMemberId: conversation?.assignedMemberId ?? memberId,
        awaitingReplySince: null,
        closeNote: note ?? null,
      },
    );
    if (!result.affected) {
      throw new ConflictException('The conversation has no open case');
    }

    return (await this.cases.findOneByOrFail({ id: open.id }));
  }

  private async open(message: Message, at: Date): Promise<Case | null> {
    const conversation = await this.dataSource.getRepository(Conversation).findOne({
      where: { id: message.conversationId },
      relations: { channel: true },
    });
    if (!conversation) return null;

    const previous = await this.cases.findOne({
      where: { conversationId: conversation.id, status: 'closed' },
      order: { closedAt: 'DESC' },
    });
    const isReopen =
      !!previous?.closedAt && at.getTime() - previous.closedAt.getTime() <= REOPEN_WINDOW_MS;

    try {
      return await this.cases.save(
        this.cases.create({
          companyId: conversation.companyId,
          conversationId: conversation.id,
          channelType: conversation.channel.type,
          customerId: conversation.customerId,
          status: 'open',
          openKey: conversation.id,
          openedAt: at,
          reopenOfCaseId: isReopen && previous ? previous.id : null,
        }),
      );
    } catch (error) {
      // A concurrent inbound message opened it first: continue that case.
      if (isDuplicateKeyError(error)) return this.findOpen(conversation.id);
      throw error;
    }
  }
}
