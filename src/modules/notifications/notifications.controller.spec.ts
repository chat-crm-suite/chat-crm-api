// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ClsService } from 'nestjs-cls';

import { CLS_COMPANY_ID, CLS_MEMBER_ID, CLS_USER_ID } from '../../config/cls.keys';
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
    const controller = build({
      [CLS_MEMBER_ID]: 'member-1',
      [CLS_USER_ID]: 'user-1',
      [CLS_COMPANY_ID]: 'company-1',
    });
    service.getPreferences.mockResolvedValue({ muted: ['spend_budget'], desktop: [] });
    service.setPreferences.mockResolvedValue({ muted: [] });

    await expect(controller.getPreferences()).resolves.toEqual({ muted: ['spend_budget'], desktop: [] });
    await expect(controller.setPreferences({ muted: [], desktop: [] })).resolves.toEqual({ muted: [] });

    expect(service.getPreferences).toHaveBeenCalledWith('member-1');
    expect(service.setPreferences).toHaveBeenCalledWith('member-1', { muted: [], desktop: [] });
  });

  it('needs a company context', () => {
    const controller = build({});

    expect(() => controller.getPreferences()).toThrow(/Company context required/);
    expect(() => controller.setPreferences({ muted: [], desktop: [] })).toThrow();
    expect(service.setPreferences).not.toHaveBeenCalled();
  });

  it('reads the list and marks read as the current member of the active company', async () => {
    const controller = build({
      [CLS_MEMBER_ID]: 'member-1',
      [CLS_USER_ID]: 'user-1',
      [CLS_COMPANY_ID]: 'company-1',
    });
    const reader = { memberId: 'member-1', userId: 'user-1', companyId: 'company-1' };
    Object.assign(service, {
      list: jest.fn().mockResolvedValue({ items: [], unreadCount: 0, nextCursor: null }),
      markRead: jest.fn().mockResolvedValue({ unreadCount: 0 }),
    });

    await controller.list({ limit: 20 });
    await controller.markAsRead('n-1');

    expect((service as unknown as { list: jest.Mock }).list).toHaveBeenCalledWith(reader, { limit: 20 });
    expect((service as unknown as { markRead: jest.Mock }).markRead).toHaveBeenCalledWith(reader, 'n-1');
  });
});
