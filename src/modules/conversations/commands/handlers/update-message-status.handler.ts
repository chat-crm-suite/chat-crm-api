// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Optional } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { toMessageStatusPatch } from '@modules/message/mappers/message-status-patch.mapper';
import { MessageService } from '@modules/message/message.service';
import { ChannelStatusReportedEvent } from '@modules/spend/events/channel-status-reported.event';
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
    @Optional() private readonly eventBus?: EventBus,
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

    await this.fanout.emitStatusPatch(toMessageStatusPatch(outcome.message));

    if (command.costReport !== undefined && command.costReport !== null) {
      this.eventBus?.publish(
        new ChannelStatusReportedEvent(
          outcome.message.companyId,
          outcome.message.conversationId,
          outcome.message.id,
          command.costReport,
          command.occurredAt,
        ),
      );
    }

    return { applied: true };
  }
}
