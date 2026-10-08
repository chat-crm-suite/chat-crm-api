// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { KillSwitchService } from '../../analysis/ia/kill-switch.service';
import { HealthCheck, HealthStatus } from '../health.enum';
import { IaProbe } from './ia.probe';

/**
 * T2: while the manual kill switch is off the readiness probe reports the IA
 * as `disabled` without performing a network fetch. When it is on, the probe
 * behaves as before: `ok`/`unreachable` (optional, never critical) and
 * `skipped` when no URL is configured.
 */
describe('IaProbe (T2)', () => {
  const config = {
    iaUrl: 'http://ia:8000',
    iaTimeoutMs: 2000,
    probeTtlMs: 10000,
  };

  const isEnabled = jest.fn();
  const fetchMock = jest.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve({ ok: true }),
  );

  const build = (overrides: Partial<typeof config> = {}) =>
    new IaProbe(
      { ...config, ...overrides },
      { isEnabled } as unknown as KillSwitchService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('reports disabled without fetching when the kill switch is off', async () => {
    isEnabled.mockResolvedValue(false);

    await expect(build().check()).resolves.toEqual({
      name: HealthCheck.Ia,
      status: HealthStatus.Disabled,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports ok when enabled and the IA answers', async () => {
    isEnabled.mockResolvedValue(true);

    await expect(build().check()).resolves.toEqual({
      name: HealthCheck.Ia,
      status: HealthStatus.Ok,
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe('http://ia:8000/health');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports unreachable when enabled but the IA does not answer', async () => {
    isEnabled.mockResolvedValue(true);
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(build().check()).resolves.toEqual({
      name: HealthCheck.Ia,
      status: HealthStatus.Unreachable,
    });
  });

  it('reports skipped without fetching when no IA url is configured', async () => {
    isEnabled.mockResolvedValue(true);

    await expect(build({ iaUrl: undefined }).check()).resolves.toEqual({
      name: HealthCheck.Ia,
      status: HealthStatus.Skipped,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
