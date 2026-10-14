// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ClsService } from 'nestjs-cls';

import { CLS_MEMBER_ID } from '../../config/cls.keys';
import { NotificationController } from './notifications.controller';
import type { NotificationsService } from './notifications.service';

describe('NotificationController preferences', () => {
  const service = {
    getPreferences: jest.fn(),
    setPreferences: jest.fn(),
  };
  const build = (values: Record<string, unknown>) =>
    new NotificationController(
      service as unknown as NotificationsService,
      { get: (key: string) => values[key] } as unknown as ClsService,
    );

  afterEach(() => jest.clearAllMocks());

  it('reads and writes the preferences of the current member (from the tenant guard)', async () => {
    const controller = build({ [CLS_MEMBER_ID]: 'member-1' });
    service.getPreferences.mockResolvedValue({ muted: ['spend_budget'] });
    service.setPreferences.mockResolvedValue({ muted: [] });

    await expect(controller.getPreferences()).resolves.toEqual({ muted: ['spend_budget'] });
    await expect(controller.setPreferences({ muted: [] })).resolves.toEqual({ muted: [] });

    expect(service.getPreferences).toHaveBeenCalledWith('member-1');
    expect(service.setPreferences).toHaveBeenCalledWith('member-1', { muted: [] });
  });

  it('needs a company context', () => {
    const controller = build({});

    expect(() => controller.getPreferences()).toThrow(/Company context required/);
    expect(() => controller.setPreferences({ muted: [] })).toThrow();
    expect(service.setPreferences).not.toHaveBeenCalled();
  });
});
