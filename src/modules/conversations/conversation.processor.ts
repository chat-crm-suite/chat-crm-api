// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { EventBus } from '@nestjs/cqrs';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { Message } from '../message/entities/message.entity';
import type { AgentSendJob } from './commands/send-conversation-message.command';
import { ConversationsService } from './conversations.service';
import type { SaveMessageJob } from './commands/save-conversation-message.command';
import { MessageSavedEvent } from './events/message-saved.event';
import { AgentMessageSender } from './outbound/agent-message-sender.service';

@Processor('chat')
export class ConversationProcessor extends WorkerHost {
  constructor(
    private readonly sender: AgentMessageSender,
    private readonly eventBus: EventBus,
    private readonly conversations: ConversationsService,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(ConversationProcessor.name);
  }

  /**
   * T5: an agent send is saved first as `pending` by the outbound pipeline,
   * which then waits for Graph's wamid before marking it `sent`. The job's
   * `attemptsMade` travels with the command so a stalled retry can finish a
   * row the dead attempt left pending.
   */
  sendAgentMessage(data: AgentSendJob, attemptsMade = 0) {
    return this.sender.send(data, { attemptsMade });
  }

  saveConversationMessage(data: SaveMessageJob) {
    return this.conversations.saveMsg(
      data.room,
      data.msg,
      data.sender,
      data.companyId,
    );
  }

  async process(job: Job<AgentSendJob | SaveMessageJob>) {
    switch (job.name) {
      case 'send-message':
        return await this.sendAgentMessage(
          job.data as AgentSendJob,
          job.attemptsMade,
        );
      case 'save-message':
        return await this.saveConversationMessage(
          job.data as SaveMessageJob,
        );
      default:
        throw new Error('Job name no handler');
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(
    job: Job<AgentSendJob | SaveMessageJob>,
    result: Message,
  ) {
    // T5: a send job no longer saves after Graph answers; the outbound
    // pipeline already persisted and broadcast the pending row.
    if (job.name === 'save-message') {
      this.eventBus.publish(new MessageSavedEvent(result, job.data.companyId));
    }
  }
}
