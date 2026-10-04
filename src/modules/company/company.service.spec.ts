import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';

import { Member } from '../member/member.entity';
import { MemberRole, MemberStatus } from '../member/member.types';
import { CompanyService } from './company.service';
import { Company } from './entities/company.entity';

describe('CompanyService', () => {
  let service: CompanyService;

  const companyRepo = {
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn(),
    findOneBy: jest.fn(),
  };

  const membersRepo = {
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
    membersRepo.save.mockImplementation((entity: Record<string, unknown>) =>
      Promise.resolve({ ...entity, id: 'member-1' }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyService,
        { provide: getRepositoryToken(Company), useValue: companyRepo },
        { provide: getRepositoryToken(Member), useValue: membersRepo },
        { provide: ClsService, useValue: cls },
      ],
    }).compile();

    service = module.get<CompanyService>(CompanyService);
  });

  it('creates the company and links the creator as an active admin member', async () => {
    cls.get.mockReturnValue('user-1');

    await service.create({ name: 'J&P Perifericos' });

    expect(membersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { id: 'user-1' },
        company: { id: 'company-1', name: 'J&P Perifericos' },
        role: MemberRole.ADMIN,
        status: MemberStatus.ACTIVE,
      }),
    );
  });

  it('does not create a membership when there is no authenticated user', async () => {
    cls.get.mockReturnValue(undefined);

    await service.create({ name: 'J&P Perifericos' });

    expect(membersRepo.save).not.toHaveBeenCalled();
  });
});
