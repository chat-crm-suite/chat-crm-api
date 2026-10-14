// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { EventBus } from '@nestjs/cqrs';
import type { ClsService } from 'nestjs-cls';
import type { Repository } from 'typeorm';

import type { CompanyMember } from '../company-members/entities/company-member.entity';
import { CompanyService } from './company.service';
import type { CompanySettings } from './entities/company-settings.entity';
import type { Company } from './entities/company.entity';
import { CompanyUpdatedEvent } from './events/company-updated.event';

describe('CompanyService', () => {
  const company = { id: 'company-1', name: 'Acme', email: 'old@acme.test', status: 'active' };
  const repo = {
    findOneBy: jest.fn(),
    exists: jest.fn(),
    update: jest.fn(),
  };
  const settingsRepo = {
    findOneBy: jest.fn(),
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    update: jest.fn(),
  };
  const membersRepo = { findOne: jest.fn() };
  const cls = { get: jest.fn() };
  const eventBus = { publish: jest.fn() };
  let service: CompanyService;

  beforeEach(() => {
    jest.clearAllMocks();
    cls.get.mockImplementation((key: string) =>
      ({ 'company.id': 'company-1', 'user.id': 'user-1' })[key],
    );
    repo.findOneBy.mockResolvedValue(company);
    repo.exists.mockResolvedValue(false);
    service = new CompanyService(
      repo as unknown as Repository<Company>,
      settingsRepo as unknown as Repository<CompanySettings>,
      membersRepo as unknown as Repository<CompanyMember>,
      cls as unknown as ClsService,
      eventBus as unknown as EventBus,
    );
  });

  it('no longer creates, lists or deletes companies (the platform console does)', () => {
    const methods = Object.getOwnPropertyNames(CompanyService.prototype);

    expect(methods).not.toEqual(
      expect.arrayContaining(['create', 'findAll', 'findOne', 'remove']),
    );
    for (const gone of ['create', 'findAll', 'findOne', 'remove']) {
      expect(methods).not.toContain(gone);
    }
  });

  describe('profile()', () => {
    it('returns the active company', async () => {
      await expect(service.profile()).resolves.toBe(company);
      expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'company-1' });
    });

    it('answers 404 when the active company is gone', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.profile()).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('updateProfile()', () => {
    it('updates the active company only and announces the change to its room', async () => {
      await service.updateProfile({ name: 'Acme Inc', timezone: 'America/Bogota' });

      expect(repo.update).toHaveBeenCalledWith('company-1', {
        name: 'Acme Inc',
        timezone: 'America/Bogota',
      });
      expect(eventBus.publish).toHaveBeenCalledWith(new CompanyUpdatedEvent('company-1'));
    });

    it('answers 409 when the email belongs to another company, without writing', async () => {
      repo.exists.mockResolvedValue(true);

      await expect(service.updateProfile({ email: 'taken@acme.test' })).rejects.toMatchObject({
        status: 409,
        response: { code: 'company_email_taken' },
      });
      expect(repo.update).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('does not look for a conflict when the email is unchanged', async () => {
      await service.updateProfile({ email: 'old@acme.test' });

      expect(repo.exists).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalled();
    });
  });

  describe('assignment settings', () => {
    it('returns exactly the four assignment fields', async () => {
      settingsRepo.findOneBy.mockResolvedValue({
        companyId: 'company-1',
        autoAssignEnabled: true,
        autoAssignMaxOpen: 10,
        autoAssignSticky: false,
        autoAssignNotifySupervisors: true,
        slaFirstResponseSeconds: 300,
      });

      await expect(service.getAssignmentSettings()).resolves.toEqual({
        autoAssignEnabled: true,
        autoAssignMaxOpen: 10,
        autoAssignSticky: false,
        autoAssignNotifySupervisors: true,
      });
    });

    it('still checks the caller is an active admin or supervisor before writing', async () => {
      membersRepo.findOne.mockResolvedValue({ role: 'agent' });

      await expect(
        service.updateAssignmentSettings({ autoAssignEnabled: false }),
      ).rejects.toMatchObject({ status: 403 });
      expect(settingsRepo.update).not.toHaveBeenCalled();
    });

    it('lets a supervisor update and returns the fresh values', async () => {
      membersRepo.findOne.mockResolvedValue({ role: 'supervisor' });
      settingsRepo.findOneBy.mockResolvedValue({
        autoAssignEnabled: false,
        autoAssignMaxOpen: 4,
        autoAssignSticky: true,
        autoAssignNotifySupervisors: true,
      });

      const result = await service.updateAssignmentSettings({
        autoAssignEnabled: false,
        autoAssignMaxOpen: 4,
      });

      expect(settingsRepo.update).toHaveBeenCalledWith(
        { companyId: 'company-1' },
        { autoAssignEnabled: false, autoAssignMaxOpen: 4 },
      );
      expect(result).toMatchObject({ autoAssignEnabled: false, autoAssignMaxOpen: 4 });
    });
  });
});
