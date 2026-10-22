// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { Queue } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';

import { NotificationDispatcher, notificationJobId } from './notification.dispatcher';
import type { NotifyInput } from './notification.types';

describe('NotificationDispatcher', () => {
  const add = jest.fn();
  const warn = jest.fn();
  const dispatcher = new NotificationDispatcher(
    { add } as unknown as Queue<NotifyInput>,
    { setContext: jest.fn(), warn } as unknown as PinoLogger,
  );
  const input: NotifyInput = {
    companyId: 'c1',
    type: 'conversation_assigned',
    audience: { memberIds: ['m1'] },
    title: 'Nuevo chat asignado',
    dedupeKey: 'assigned:conv-1:a1',
  };

  afterEach(() => jest.clearAllMocks());

  it('enqueues with a job id derived from the event identity (same event = same job)', async () => {
    await dispatcher.notify(input);
    await dispatcher.notify({ ...input, title: 'retry' });

    const [first, second] = add.mock.calls.map(([, , options]) => (options as { jobId: string }).jobId);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{40}$/); // BullMQ refuses ':' in custom ids
    expect(notificationJobId({ ...input, dedupeKey: 'other' })).not.toBe(first);
    expect(notificationJobId({ ...input, companyId: 'c2' })).not.toBe(first);
  });

  it('never throws when the queue is down', async () => {
    add.mockRejectedValueOnce(new Error('redis down'));

    await expect(dispatcher.notify(input)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
