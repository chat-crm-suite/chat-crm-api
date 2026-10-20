// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createHash } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { DELIVER_JOB, NOTIFICATIONS_QUEUE, type NotifyInput } from './notification.types';

/** BullMQ custom ids may not contain `:`; a hash also bounds the length. */
export const notificationJobId = (input: Pick<NotifyInput, 'companyId' | 'type' | 'dedupeKey'>) =>
  createHash('sha1')
    .update(`${input.companyId}|${input.type}|${input.dedupeKey}`)
    .digest('hex');

/**
 * The only way to notify someone. Producers enqueue and return at once: the
 * request or webhook never waits on recipients, MySQL or sockets. The job id
 * derives from the event identity, so publishing the same event twice queues
 * it once. Never throws: a lost notice must not break the caller's flow.
 */
@Injectable()
export class NotificationDispatcher {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue<NotifyInput>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationDispatcher.name);
  }

  async notify(input: NotifyInput): Promise<void> {
    try {
      await this.queue.add(DELIVER_JOB, input, { jobId: notificationJobId(input) });
    } catch (error) {
      this.logger.warn(
        { type: input.type, companyId: input.companyId, error: String(error) },
        'Notification enqueue failed',
      );
    }
  }
}
