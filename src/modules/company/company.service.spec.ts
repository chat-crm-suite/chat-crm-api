// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';

import { CompanyMember } from '../company-members/entities/company-member.entity';
import { PipelineStage } from '../customers/entities/pipeline-stage.entity';
import { CompanyService } from './company.service';
import { CompanySettings } from './entities/company-settings.entity';
import { Company } from './entities/company.entity';

describe('CompanyService', () => {
  let service: CompanyService;

  const companyRepo = {
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn(),
    findOneBy: jest.fn(),
  };

  const settingsRepo = {
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn(),
  };

  const membersRepo = {
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn(),
  };

  const stagesRepo = {
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn(),
  };

  const cls = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    companyRepo.save.mockImplementation((entity: Record<string, unknown>) =>
      Promise.resolve({
        ...entity,
        id: 'company-1',
      }),
    );
    settingsRepo.save.mockImplementation((entity: Record<string, unknown>) =>
      Promise.resolve({ ...entity, id: 'settings-1' }),
    );
    membersRepo.save.mockImplementation((entity: Record<string, unknown>) =>
      Promise.resolve({ ...entity, id: 'member-1' }),
    );
    stagesRepo.save.mockImplementation((entity: unknown) =>
      Promise.resolve(
        Array.isArray(entity)
          ? entity
          : { ...(entity as Record<string, unknown>), id: 'stage-1' },
      ),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyService,
        { provide: getRepositoryToken(Company), useValue: companyRepo },
        { provide: getRepositoryToken(CompanySettings), useValue: settingsRepo },
        { provide: getRepositoryToken(CompanyMember), useValue: membersRepo },
        { provide: getRepositoryToken(PipelineStage), useValue: stagesRepo },
        { provide: ClsService, useValue: cls },
      ],
    }).compile();

    service = module.get<CompanyService>(CompanyService);
  });

  it('creates company + settings + default stages and links the creator as an active admin member', async () => {
    cls.get.mockReturnValue('user-1');

    await service.create({ name: 'J&P Perifericos' });

    expect(companyRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'J&P Perifericos' }),
    );
    expect(settingsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1' }),
    );
    expect(stagesRepo.save).toHaveBeenCalledTimes(1);
    expect(membersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        companyId: 'company-1',
        role: 'admin',
        status: 'active',
      }),
    );
  });

  it('does not create a membership when there is no authenticated user', async () => {
    cls.get.mockReturnValue(undefined);

    await service.create({ name: 'J&P Perifericos' });

    expect(settingsRepo.save).toHaveBeenCalledTimes(1);
    expect(membersRepo.save).not.toHaveBeenCalled();
  });
});
