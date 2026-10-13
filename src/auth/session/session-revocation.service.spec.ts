// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { Cache } from '@nestjs/cache-manager';
import type { EventBus } from '@nestjs/cqrs';
import type { PinoLogger } from 'nestjs-pino';

import type { JwtPayload } from '../auth.types';
import { JWT_EXPIRES_IN_SECONDS } from '../jwt.config';
import {
  SessionRevocationService,
  STALE_MARKER_LOCAL_TTL_MS,
} from './session-revocation.service';
import { UserSessionsRevokedEvent } from './user-sessions-revoked.event';

const token = (ts: number): JwtPayload => ({
  sub: 'user-1',
  memberships: [{ cid: 'company-1', mid: 'member-1', role: 'agent' }],
  ts,
});

describe('SessionRevocationService', () => {
  let store: Map<string, number>;
  let cache: { get: jest.Mock; set: jest.Mock };
  let eventBus: { publish: jest.Mock };
  let service: SessionRevocationService;

  const build = () =>
    new SessionRevocationService(
      cache as unknown as Cache,
      eventBus as unknown as EventBus,
      { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger,
    );

  beforeEach(() => {
    store = new Map();
    cache = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key))),
      set: jest.fn((key: string, value: number) => {
        store.set(key, value);
        return Promise.resolve();
      }),
    };
    eventBus = { publish: jest.fn() };
    service = build();
  });

  it('accepts a fresh token when the user was never revoked', async () => {
    await expect(service.isStale(token(1_000))).resolves.toBe(false);
  });

  it('treats tokens issued before the tenant claims as stale', async () => {
    await expect(
      service.isStale({ sub: 'user-1' } as Partial<JwtPayload>),
    ).resolves.toBe(true);
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('marks earlier tokens stale, keeps later ones, and kicks sockets', async () => {
    await service.revoke('user-1', 5_000);

    expect(cache.set).toHaveBeenCalledWith(
      'auth:stale:user-1',
      5_000,
      JWT_EXPIRES_IN_SECONDS * 1000,
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      new UserSessionsRevokedEvent('user-1'),
    );
    await expect(service.isStale(token(4_999), 5_001)).resolves.toBe(true);
    await expect(service.isStale(token(5_000), 5_001)).resolves.toBe(false);
  });

  it('sees a revocation written by another process once its local view expires', async () => {
    await expect(service.isStale(token(1_000), 2_000)).resolves.toBe(false);
    store.set('auth:stale:user-1', 3_000);

    // Within the local window the cached "not stale" answer is reused.
    await expect(service.isStale(token(1_000), 2_001)).resolves.toBe(false);
    expect(cache.get).toHaveBeenCalledTimes(1);

    await expect(
      service.isStale(token(1_000), 2_000 + STALE_MARKER_LOCAL_TTL_MS),
    ).resolves.toBe(true);
    expect(cache.get).toHaveBeenCalledTimes(2);
  });

  it('keeps the local marker and still kicks sockets when the cache write fails', async () => {
    cache.set.mockRejectedValue(new Error('redis down'));

    await service.revoke('user-1', 5_000);

    expect(eventBus.publish).toHaveBeenCalled();
    await expect(service.isStale(token(4_000), 5_001)).resolves.toBe(true);
  });

  it('fails open on a cache read outage (the signature is still verified)', async () => {
    cache.get.mockRejectedValue(new Error('redis down'));

    await expect(service.isStale(token(1_000))).resolves.toBe(false);
  });
});
