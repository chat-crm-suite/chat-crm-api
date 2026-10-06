// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { WhatsAppService } from '../../whatsapp.service';
import { SendWhatsAppMessageCommand } from '../send-whatsapp-message.command';

@CommandHandler(SendWhatsAppMessageCommand)
export class SendWhatsAppMessageHandler
  implements ICommandHandler<SendWhatsAppMessageCommand>
{
  constructor(
    private readonly logger: PinoLogger,
    private readonly service: WhatsAppService,
  ) {
    this.logger.setContext(SendWhatsAppMessageCommand.name);
  }

  async execute(command: SendWhatsAppMessageCommand): Promise<unknown> {
    const res = await this.service.sendMessage(
      command.payload,
      command.companyId,
    );
    this.logger.debug(res, 'Send WhatsAppMessage');
    return res;
  }
}
