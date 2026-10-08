// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ForbiddenException } from '@nestjs/common';

import type { CompanyMemberService } from '../../company-members/company-member.service';
import { IaAdminService } from './ia-admin.service';
import type { KillSwitchService } from './kill-switch.service';

/**
 * T2: the admin toggle reuses the privileged-endpoint pattern (JWT + active
 * company membership) and only an active company admin may flip the switch.
 * Every accepted toggle is logged with the resolved state; a Redis write
 * failure is a real error and surfaces as such.
 */
describe('IaAdminService (T2)', () => {
  const getMemberActive = jest.fn();
  const setEnabled = jest.fn();
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  };

  const adminMember = {
    id: 'member-1',
    userId: 'user-1',
    companyId: 'company-1',
    role: 'admin',
    status: 'active',
  };

  const build = () =>
    new IaAdminService(
      { setEnabled } as unknown as KillSwitchService,
      { getMemberActive } as unknown as CompanyMemberService,
      logger as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    getMemberActive.mockResolvedValue(adminMember);
    setEnabled.mockResolvedValue(false);
  });

  it('toggles for an active company admin, logging the resolved state', async () => {
    await expect(build().toggle(false)).resolves.toEqual({ enabled: false });

    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        userId: 'user-1',
        companyId: 'company-1',
      }),
      expect.any(String),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each(['agent', 'supervisor'])(
    'forbids a %s membership and never writes the flag',
    async (role) => {
      getMemberActive.mockResolvedValue({ ...adminMember, role });

      await expect(build().toggle(false)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(setEnabled).not.toHaveBeenCalled();
    },
  );

  it('forbids a user without a membership in the active company', async () => {
    getMemberActive.mockResolvedValue(null);

    await expect(build().toggle(false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it('forbids an inactive admin', async () => {
    getMemberActive.mockResolvedValue({ ...adminMember, status: 'suspended' });

    await expect(build().toggle(false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it('logs at error level and rethrows when Redis cannot persist the flag', async () => {
    setEnabled.mockRejectedValue(new Error('redis down'));

    await expect(build().toggle(false)).rejects.toThrow('redis down');
    expect(logger.error).toHaveBeenCalled();
  });
});
