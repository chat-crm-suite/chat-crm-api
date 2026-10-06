// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, EntityTarget, Repository } from 'typeorm';

import * as Entities from '@entities';
import { MessageFactory } from '@factories';

import {
  getTestConfig,
  truncateAllTables,
} from '../../../test/helpers/test-database.helper';
import { MessageAttachment } from './entities/message-attachment.entity';
import { MessageStatusEvent } from './entities/message-status-event.entity';
import { Message } from './entities/message.entity';
import { MessageRepository } from './message.repository';
import { MessageService } from './message.service';

const entities = Object.values(Entities) as EntityTarget<unknown>[];

jest.setTimeout(120_000);

/**
 * T4 delivery states, observed at the message-service seam over the real
 * schema: Meta statuses arrive keyed by `wamid` (`messages.external_id`), the
 * current state and its update time live on the message row, failures keep
 * their error, and every applied transition is appended to the history table.
 *
 * Regressions are ignored per the message lifecycle
 * (`docs/database/README.md` — Message lifecycle): `pending < sent < delivered < read`, and
 * `failed` always wins.
 */
describe('MessageService delivery states (integration)', () => {
  let module: TestingModule;
  let service: MessageService;
  let dataSource: DataSource;
  let events: Repository<MessageStatusEvent>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(getTestConfig(entities)),
        TypeOrmModule.forFeature([
          Message,
          MessageAttachment,
          MessageStatusEvent,
        ]),
      ],
      providers: [MessageService, MessageRepository],
    }).compile();

    service = module.get(MessageService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    events = dataSource.getRepository(MessageStatusEvent);
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
    if (module) await module.close();
  });

  const occurredAt = new Date('2026-10-05T12:00:00.000Z');

  /** Outbound row already carrying its Graph `wamid`, as the sender leaves it. */
  const seedOutbound = (overrides: Partial<Message> = {}) =>
    MessageFactory.transient({ manager: dataSource.manager }).create({
      externalId: 'wamid-out-1',
      direction: 'outbound',
      senderType: 'member',
      status: 'sent',
      ...overrides,
    });

  const reload = (id: string) =>
    dataSource.getRepository(Message).findOneByOrFail({ id });

  it('updates the persisted state by wamid and appends the status event', async () => {
    const message = await seedOutbound();

    const outcome = await service.applyDeliveryStatus({
      wamid: 'wamid-out-1',
      status: 'delivered',
      occurredAt,
    });

    expect(outcome.applied).toBe(true);
    const reloaded = await reload(message.id);
    expect(reloaded.status).toBe('delivered');
    expect(reloaded.statusUpdatedAt).toEqual(occurredAt);

    const history = await events.find({ where: { messageId: message.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'delivered', errorCode: null });
    expect(history[0].occurredAt).toEqual(occurredAt);
  });

  it('ignores a wamid that has no persisted message', async () => {
    const outcome = await service.applyDeliveryStatus({
      wamid: 'wamid-ghost',
      status: 'delivered',
      occurredAt,
    });

    expect(outcome.applied).toBe(false);
    expect(await events.count()).toBe(0);
  });

  it('stores the error code and message on a failed state', async () => {
    const message = await seedOutbound();
    const failedAt = new Date('2026-10-05T12:05:00.000Z');

    const outcome = await service.applyDeliveryStatus({
      wamid: 'wamid-out-1',
      status: 'failed',
      occurredAt: failedAt,
      errorCode: '131047',
      errorMessage: 'Re-engagement message',
    });

    expect(outcome.applied).toBe(true);
    const reloaded = await reload(message.id);
    expect(reloaded.status).toBe('failed');
    expect(reloaded.errorCode).toBe('131047');
    expect(reloaded.errorMessage).toBe('Re-engagement message');
    expect(reloaded.statusUpdatedAt).toEqual(failedAt);

    const history = await events.find({ where: { messageId: message.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'failed', errorCode: '131047' });
  });

  it('ignores a late delivered that would downgrade read', async () => {
    const message = await seedOutbound({ status: 'read' });

    const outcome = await service.applyDeliveryStatus({
      wamid: 'wamid-out-1',
      status: 'delivered',
      occurredAt,
    });

    expect(outcome.applied).toBe(false);
    expect((await reload(message.id)).status).toBe('read');
    expect(await events.count()).toBe(0);
  });

  it('refuses a stale transition when the current status no longer allows it', async () => {
    const message = await seedOutbound({ status: 'read' });
    const repository = module.get(MessageRepository);

    const saved = await repository.applyStatus(
      message.id,
      { status: 'delivered', occurredAt },
      ['pending', 'sent'],
    );

    expect(saved).toBeNull();
    expect((await reload(message.id)).status).toBe('read');
    expect(await events.count({ where: { messageId: message.id } })).toBe(0);
  });

  it('never regresses when a delivered and a read land out of order', async () => {
    const message = await seedOutbound({ status: 'sent' });

    await Promise.all([
      service.applyDeliveryStatus({
        wamid: 'wamid-out-1',
        status: 'read',
        occurredAt: new Date('2026-10-05T12:20:00.000Z'),
      }),
      service.applyDeliveryStatus({
        wamid: 'wamid-out-1',
        status: 'delivered',
        occurredAt: new Date('2026-10-05T12:21:00.000Z'),
      }),
    ]);

    expect((await reload(message.id)).status).toBe('read');

    const history = await events.find({
      where: { messageId: message.id },
      order: { id: 'ASC' },
    });
    const rank = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
    const ranks = history.map((row) => rank[row.status]);

    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('keeps failed as the final state, with its error intact', async () => {
    const message = await seedOutbound({ status: 'read' });

    const failed = await service.applyDeliveryStatus({
      wamid: 'wamid-out-1',
      status: 'failed',
      occurredAt,
      errorCode: '131026',
      errorMessage: 'Message undeliverable',
    });
    const lateRead = await service.applyDeliveryStatus({
      wamid: 'wamid-out-1',
      status: 'read',
      occurredAt: new Date('2026-10-05T12:10:00.000Z'),
    });

    expect(failed.applied).toBe(true);
    expect(lateRead.applied).toBe(false);
    const reloaded = await reload(message.id);
    expect(reloaded.status).toBe('failed');
    expect(reloaded.errorCode).toBe('131026');
    expect(reloaded.errorMessage).toBe('Message undeliverable');
  });
});
