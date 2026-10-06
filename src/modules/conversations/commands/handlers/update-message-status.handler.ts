import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import type { ConversationMessageStatusPatch } from '../../../../contracts/index';
import type { Message } from '../../../message/entities/message.entity';
import { MessageService } from '../../../message/message.service';
import { ConversationFanoutService } from '../../realtime/conversation-fanout.service';
import { UpdateMessageStatusCommand } from '../update-message-status.command';

/**
 * T4/T6: applies a Meta delivery state by `wamid` and pushes the resulting
 * state patch live through the single fanout path (conversation room plus
 * assignee preview). The broadcast event keeps its shape.
 */
@CommandHandler(UpdateMessageStatusCommand)
export class UpdateMessageStatusHandler implements ICommandHandler<UpdateMessageStatusCommand> {
  constructor(
    private readonly messages: MessageService,
    private readonly fanout: ConversationFanoutService,
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

    await this.fanout.emitStatusPatch(toStatusPatch(outcome.message));

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
