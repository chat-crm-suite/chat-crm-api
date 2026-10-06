// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { ConversationsService } from '../../conversations.service';
import { AssignmentOutcome } from '../../assignment/assignment.types';
import { ClaimConversationCommand } from '../claim-conversation.command';

@CommandHandler(ClaimConversationCommand)
export class ClaimConversationHandler
  implements ICommandHandler<ClaimConversationCommand>
{
  constructor(
    private readonly conversations: ConversationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ClaimConversationHandler.name);
  }

  async execute(command: ClaimConversationCommand): Promise<AssignmentOutcome> {
    try {
      return await this.conversations.claimForMember(
        command.conversationId,
        command.memberId,
        command.companyId,
      );
    } catch (error) {
      this.logger.error(
        {
          conversationId: command.conversationId,
          memberId: command.memberId,
          error: String(error),
        },
        'Claim failed',
      );
      return AssignmentOutcome.SKIPPED;
    }
  }
}
