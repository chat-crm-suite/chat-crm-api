// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, IsNull, Repository } from 'typeorm';

import { getTestSQLiteConfig } from '@helpers/test-database.helper';
import { MemoryRedis } from '@helpers/memory-redis';
import { APP_REDIS } from '../../common/redis/app-redis.module';
import { PresenceInterval } from './entities/presence-interval.entity';
import { PresenceService } from './presence.service';

const logger = { setContext: jest.fn(), warn: jest.fn() };

/**
 * Presence is the source of connected/available time: one open interval per
 * online member, in the state the member chose (kept across reconnects).
 */
describe('PresenceService', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let intervals: Repository<PresenceInterval>;
  let service: PresenceService;
  const redis = new MemoryRedis();
  const eventBus = { publish: jest.fn() };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(getTestSQLiteConfig([PresenceInterval])),
        TypeOrmModule.forFeature([PresenceInterval]),
      ],
      providers: [
        { provide: APP_REDIS, useValue: redis },
        { provide: PinoLogger, useValue: logger },
        {
          provide: PresenceService,
          useFactory: (repo: Repository<PresenceInterval>) =>
            new PresenceService(repo, redis as never, logger as never, eventBus as never),
          inject: [getRepositoryToken(PresenceInterval)],
        },
      ],
    }).compile();

    dataSource = module.get(getDataSourceToken());
    intervals = dataSource.getRepository(PresenceInterval);
    service = module.get(PresenceService);
  }, 60_000);

  afterAll(async () => {
    await dataSource?.destroy();
    await module?.close();
  });

  beforeEach(async () => {
    await intervals.clear();
    redis.store.clear();
    redis.failing = false;
    eventBus.publish.mockClear();
  });

  it('opens one interval per connected member and closes it on disconnect', async () => {
    await service.connected('company', 'member');
    await service.connected('company', 'member');
    expect(await intervals.count({ where: { endedAt: IsNull() } })).toBe(1);
    expect((await service.get('member')).state).toBe('available');

    await service.disconnected('company', 'member');
    expect((await service.get('member')).state).toBe('offline');
    expect(eventBus.publish).toHaveBeenCalledTimes(2);
  });

  it('switches state by closing the interval and opening a new one', async () => {
    await service.connected('company', 'member');
    await service.setState('company', 'member', 'away');

    const rows = await intervals.find({ order: { startedAt: 'ASC' } });
    expect(rows.map((row) => [row.state, row.endedAt === null])).toEqual([
      ['available', false],
      ['away', true],
    ]);

    // Same state again is a no-op.
    await service.setState('company', 'member', 'away');
    expect(await intervals.count()).toBe(2);
  });

  it('remembers the chosen state across reconnects, and fails open without Redis', async () => {
    await service.setState('company', 'member', 'away');
    await service.disconnected('company', 'member');
    await service.connected('company', 'member');
    expect((await service.get('member')).state).toBe('away');

    await service.disconnected('company', 'member');
    redis.failing = true;
    await service.connected('company', 'member');
    expect((await service.get('member')).state).toBe('available');
  });

  it('reports many members at once, offline by default', async () => {
    await service.connected('company', 'a');
    const current = await service.current('company', ['a', 'b']);
    expect(current.get('a')?.state).toBe('available');
    expect(current.get('b')).toEqual({ state: 'offline', since: null });
  });
});
