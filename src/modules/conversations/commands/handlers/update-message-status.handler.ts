import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import {
  ConversationSocketEvent,
  type ConversationMessageStatusPatch,
} from '../../../../contracts/index';
import type { Message } from '../../../message/entities/message.entity';
import { MessageService } from '../../../message/message.service';
import { ConversationAssignmentService } from '../../assignment/conversation-assignment.service';
import { ConversationGateway } from '../../gateways/conversation.gateway';
import { UpdateMessageStatusCommand } from '../update-message-status.command';

/**
 * T4: applies a Meta delivery state by `wamid` and pushes the resulting state
 * patch live to the conversation room plus the assignee's personal room. The
 * broadcast event keeps its shape: this only adds `conversation:message:status`.
 */
@CommandHandler(UpdateMessageStatusCommand)
export class UpdateMessageStatusHandler implements ICommandHandler<UpdateMessageStatusCommand> {
  constructor(
    private readonly messages: MessageService,
    private readonly assignment: ConversationAssignmentService,
    private readonly gateway: ConversationGateway,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(UpdateMessageStatusHandler.name);
  }

  async execute(
    command: UpdateMessageStatusCommand,
  ): Promise<{ applied: boolean }> {
    const outcome = await this.messages.applyDeliveryStatus({
      wamid: command.wamid,
      status: command.status,
      occurredAt: command.occurredAt,
      errorCode: command.error?.code ?? null,
      errorMessage: command.error?.message ?? null,
    });

    if (!outcome.applied || !outcome.message) {
      this.logger.debug(
        { wamid: command.wamid, status: command.status },
        'Delivery status ignored (unknown wamid or regression)',
      );
      return { applied: false };
    }

    const patch = toStatusPatch(outcome.message);

    this.gateway.server
      ?.to(`conversation:${patch.conversationId}`)
      .emit(ConversationSocketEvent.MessageStatus, patch);

    const active = await this.assignment.getActiveAssignment(
      patch.conversationId,
    );
    const assigneeUserId = active?.member?.userId;
    if (assigneeUserId) {
      this.gateway.server
        ?.to(`user:${assigneeUserId}`)
        .emit(ConversationSocketEvent.MessageStatus, patch);
    }

    return { applied: true };
  }
}

function toStatusPatch(message: Message): ConversationMessageStatusPatch {
  return {
    id: message.id,
    conversationId: message.conversationId,
    clientMessageId: message.clientMessageId ?? null,
    status: message.status,
    at: message.statusUpdatedAt ?? new Date(),
    errorCode: message.errorCode ?? null,
    errorMessage: message.errorMessage ?? null,
  };
}
