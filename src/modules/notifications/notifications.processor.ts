// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { NotificationDeliveryService } from './notification-delivery.service';
import { DELIVER_JOB, NOTIFICATIONS_QUEUE, type NotifyInput } from './notification.types';

/**
 * Runs deliveries one at a time per process (BullMQ default concurrency), so
 * two events of the same group never race to insert two rows.
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  constructor(
    private readonly delivery: NotificationDeliveryService,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(NotificationsProcessor.name);
  }

  async process(job: Job<NotifyInput>) {
    if (job.name !== DELIVER_JOB) throw new Error(`Unknown notification job ${job.name}`);

    const outcomes = await this.delivery.deliver(job.data);
    return Object.fromEntries(outcomes);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<NotifyInput> | undefined, error: Error) {
    this.logger.warn(
      { jobId: job?.id, type: job?.data.type, attempts: job?.attemptsMade, error: error.message },
      'Notification delivery failed',
    );
  }
}
