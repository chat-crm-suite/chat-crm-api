import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import {
  ConversationSocketEvent,
  type ConversationMessageStatusPatch,
} from '../../../contracts/index';
import type { ConversationMessagePayload } from '../../message/message.types';
import { ConversationGateway } from '../gateways/conversation.gateway';
import { ConversationAccessService } from './conversation-access.service';

/**
 * T6 single fanout path for conversation content.
 *
 * Message bodies and delivery patches leave through here: the conversation
 * room carries the thread, the assignee's personal room carries the preview.
 * The company room is deliberately never a target, so no body can leak to a
 * company-wide audience; membership is enforced on join by
 * `ConversationAccessService`.
 */
@Injectable()
export class ConversationFanoutService {
  constructor(
    private readonly gateway: ConversationGateway,
    private readonly access: ConversationAccessService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversationFanoutService.name);
  }

  /** Live message body: open thread + assignee preview. */
  emitMessage(
    conversationId: string,
    payload: ConversationMessagePayload,
  ): Promise<void> {
    return this.emitToThreadAndAssignee(
      conversationId,
      ConversationSocketEvent.BroadcastMessage,
      payload,
    );
  }

  /** Live delivery-state patch: same routing as the message body. */
  emitStatusPatch(patch: ConversationMessageStatusPatch): Promise<void> {
    return this.emitToThreadAndAssignee(
      patch.conversationId,
      ConversationSocketEvent.MessageStatus,
      patch,
    );
  }

  private async emitToThreadAndAssignee(
    conversationId: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    const server = this.gateway.server;
    if (!server || !conversationId) {
      this.logger.warn(
        { conversationId, event },
        'Fanout skipped: no server or conversation',
      );
      return;
    }

    server.to(`conversation:${conversationId}`).emit(event, payload);

    const assignee = await this.access.getActiveAssignee(conversationId);
    if (assignee?.userId) {
      server.to(`user:${assignee.userId}`).emit(event, payload);
    }
  }
}
