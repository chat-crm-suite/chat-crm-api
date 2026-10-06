// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ForbiddenException, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, IsNull } from 'typeorm';

import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { ConversationAssignmentService } from '../assignment/conversation-assignment.service';
import { ConversationAssignment } from '../entities/conversation-assignment.entity';
import { Conversation } from '../entities/conversation.entity';

/** Socket identity resolved from the handshake (JWT cookie + auth/headers). */
export interface ConversationSocketIdentity {
  userId: string | null;
  companyId: string | null;
  /** True when `userId` comes from a verified access token, not a raw header. */
  authenticated: boolean;
}

/** Current owner of a conversation: member id plus the user behind it. */
export interface ConversationAssignee {
  memberId: string;
  userId: string;
}

/**
 * T6 access seam: membership and company isolation for the realtime layer.
 *
 * - Every room join is authorized against `company_members` (active membership
 *   plus role) and the conversation's company.
 * - Agents only reach conversations assigned to them or still in the
 *   unassigned queue; admin/supervisor reach every conversation of their
 *   company.
 * - Nothing of another company is ever reachable.
 */
@Injectable()
export class ConversationAccessService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly assignments: ConversationAssignmentService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversationAccessService.name);
  }

  /** Active member of the identity's company, or null when there is none. */
  async findActiveMember(
    identity: ConversationSocketIdentity,
  ): Promise<CompanyMember | null> {
    const { userId, companyId } = identity;
    if (!userId || !companyId) return null;

    return this.dataSource.getRepository(CompanyMember).findOne({
      where: { companyId, userId, status: 'active' },
    });
  }

  /** Current owner of the conversation (active assignment), or null. */
  async getActiveAssignee(
    conversationId: string,
  ): Promise<ConversationAssignee | null> {
    const active = await this.assignments.getActiveAssignment(conversationId);
    const memberId = active?.memberId;
    const userId = active?.member?.userId;
    if (!memberId || !userId) return null;

    return { memberId, userId };
  }

  /**
   * Agent: own conversation or unassigned queue. Admin/supervisor: any
   * conversation of their company. Cross-company and non-members: no.
   */
  async canJoinConversation(
    conversationId: string,
    identity: ConversationSocketIdentity,
  ): Promise<boolean> {
    const { userId, companyId } = identity;
    if (!userId || !companyId) return false;

    const conversation = await this.dataSource
      .getRepository(Conversation)
      .findOne({
        where: { id: conversationId, deletedAt: IsNull() },
        select: { id: true, companyId: true },
      });
    if (!conversation || conversation.companyId !== companyId) {
      this.logger.debug(
        { conversationId, companyId },
        'Join denied: conversation is not in the company',
      );
      return false;
    }

    const member = await this.findActiveMember(identity);
    if (!member) {
      this.logger.debug(
        { conversationId, userId, companyId },
        'Join denied: no active membership',
      );
      return false;
    }

    if (member.role === 'admin' || member.role === 'supervisor') return true;

    const active = await this.dataSource
      .getRepository(ConversationAssignment)
      .findOne({
        where: { conversationId, unassignedAt: IsNull() },
        select: { memberId: true },
      });

    return !active || active.memberId === member.id;
  }

  /** Throws `ForbiddenException` when the identity may not join the room. */
  async assertCanJoinConversation(
    conversationId: string,
    identity: ConversationSocketIdentity,
  ): Promise<{ room: string }> {
    if (!(await this.canJoinConversation(conversationId, identity))) {
      throw new ForbiddenException('Conversation access denied');
    }

    return { room: `conversation:${conversationId}` };
  }
}
