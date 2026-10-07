// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { KILL_SWITCH_KEY, KillSwitchService } from './kill-switch.service';

type MockRedis = {
  get: jest.Mock;
  set: jest.Mock;
  disconnect: jest.Mock;
};

/**
 * T2: the manual kill switch lives in Redis under `ia:enabled` as a boolean
 * string, absent means enabled, and a Redis failure fails open (analysis keeps
 * working) with a warning — never an error.
 */
describe('KillSwitchService (T2)', () => {
  let client: MockRedis;
  let service: KillSwitchService;

  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    client = {
      get: jest.fn(),
      set: jest.fn(),
      disconnect: jest.fn(),
    };

    service = new KillSwitchService(logger as never, client as never);
  });

  it('treats an absent flag as enabled', async () => {
    client.get.mockResolvedValue(null);

    await expect(service.isEnabled()).resolves.toBe(true);
    expect(client.get).toHaveBeenCalledWith(KILL_SWITCH_KEY);
    expect(KILL_SWITCH_KEY).toBe('ia:enabled');
  });

  it('only an explicit false disables the IA', async () => {
    client.get.mockResolvedValue('false');
    await expect(service.isEnabled()).resolves.toBe(false);

    client.get.mockResolvedValue('true');
    await expect(service.isEnabled()).resolves.toBe(true);
  });

  it('fails open when Redis cannot be read, warning instead of erroring', async () => {
    client.get.mockRejectedValue(new Error('redis down'));

    await expect(service.isEnabled()).resolves.toBe(true);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('persists the new state as a string and returns the resulting state', async () => {
    await expect(service.setEnabled(false)).resolves.toBe(false);
    expect(client.set).toHaveBeenCalledWith(KILL_SWITCH_KEY, 'false');

    await expect(service.setEnabled(true)).resolves.toBe(true);
    expect(client.set).toHaveBeenLastCalledWith(KILL_SWITCH_KEY, 'true');
  });

  it('disconnects the Redis client on module destroy', () => {
    service.onModuleDestroy();

    expect(client.disconnect).toHaveBeenCalled();
  });
});
