import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

import { Company, User, WhatsAppConfig } from '../../entities/index';
import { Member } from '../member/member.entity';
import { MemberRole, MemberStatus } from '../member/member.types';
import { CreateSetupDto } from './dto/create-setup.dto';
import { SetupService } from './setup.service';

type MockRepo = {
  count: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

const createMockRepo = (): MockRepo => ({
  count: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((entity: unknown) => entity),
  save: jest.fn((entity: Record<string, unknown>) =>
    Promise.resolve({
      ...entity,
      id: 'saved-id',
    }),
  ),
});

describe('SetupService', () => {
  let service: SetupService;
  let usersRepo: MockRepo;
  let companiesRepo: MockRepo;
  let membersRepo: MockRepo;
  let whatsappRepo: MockRepo;
  let transaction: jest.Mock;

  const dto = (): CreateSetupDto => ({
    admin: { username: 'admin', password: 'secreta-123' },
    company: { name: 'J&P Perifericos' },
  });

  const mockStatusCounts = (
    companies: number,
    admins: number,
    whatsapp: number,
  ) => {
    companiesRepo.count.mockResolvedValue(companies);
    membersRepo.count.mockResolvedValue(admins);
    whatsappRepo.count.mockResolvedValue(whatsapp);
  };

  beforeEach(async () => {
    usersRepo = createMockRepo();
    companiesRepo = createMockRepo();
    membersRepo = createMockRepo();
    whatsappRepo = createMockRepo();

    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === User) return usersRepo;
        if (entity === Company) return companiesRepo;
        if (entity === Member) return membersRepo;
        if (entity === WhatsAppConfig) return whatsappRepo;
        throw new Error('unexpected entity');
      }),
    };

    transaction = jest.fn((cb: (m: unknown) => unknown) => cb(manager));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(Company), useValue: companiesRepo },
        { provide: getRepositoryToken(Member), useValue: membersRepo },
        { provide: getRepositoryToken(WhatsAppConfig), useValue: whatsappRepo },
        { provide: DataSource, useValue: { transaction } },
      ],
    }).compile();

    service = module.get<SetupService>(SetupService);
  });

  describe('status', () => {
    it('reports a fresh database as not initialized', async () => {
      mockStatusCounts(0, 0, 0);

      await expect(service.status()).resolves.toEqual({
        initialized: false,
        hasAdmin: false,
        hasCompany: false,
        hasWhatsapp: false,
      });
    });

    it('does not count a loose user without an admin membership', async () => {
      // Solo hay un usuario (bootstrap legacy): empresa y admins siguen en 0.
      mockStatusCounts(0, 0, 0);

      const status = await service.status();

      expect(status.initialized).toBe(false);
      expect(status.hasAdmin).toBe(false);
    });

    it('is initialized only with company + active admin member', async () => {
      mockStatusCounts(1, 1, 0);

      const status = await service.status();

      expect(status).toMatchObject({
        initialized: true,
        hasAdmin: true,
        hasCompany: true,
        hasWhatsapp: false,
      });
      expect(membersRepo.count).toHaveBeenCalledWith({
        where: { role: MemberRole.ADMIN, status: MemberStatus.ACTIVE },
      });
    });

    it('reports whatsapp connectivity independently', async () => {
      mockStatusCounts(1, 1, 1);

      await expect(service.status()).resolves.toMatchObject({
        initialized: true,
        hasWhatsapp: true,
      });
    });
  });

  describe('run', () => {
    it('rejects with a conflict when the app is already initialized', async () => {
      mockStatusCounts(1, 1, 1);

      await expect(service.run(dto())).rejects.toBeInstanceOf(ConflictException);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('creates user, company, admin membership and whatsapp config atomically', async () => {
      mockStatusCounts(0, 0, 0);
      companiesRepo.findOne.mockResolvedValue(null);
      usersRepo.findOne.mockResolvedValue(null);
      membersRepo.findOne.mockResolvedValue(null);

      await service.run({
        ...dto(),
        whatsapp: {
          businessId: 'biz-1',
          accessToken: 'token',
          phoneNumberId: 'phone-1',
          webhookUrl: 'http://localhost:3000/integration/webhook/whatsapp',
        },
      });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(companiesRepo.save).toHaveBeenCalledTimes(1);
      expect(usersRepo.save).toHaveBeenCalledTimes(1);
      expect(membersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          role: MemberRole.ADMIN,
          status: MemberStatus.ACTIVE,
        }),
      );
      expect(whatsappRepo.save).toHaveBeenCalledTimes(1);
    });

    it('skips the whatsapp config when the step is omitted', async () => {
      mockStatusCounts(0, 0, 0);
      companiesRepo.findOne.mockResolvedValue(null);
      usersRepo.findOne.mockResolvedValue(null);
      membersRepo.findOne.mockResolvedValue(null);

      await service.run(dto());

      expect(whatsappRepo.save).not.toHaveBeenCalled();
    });

    it('reuses an existing company instead of creating a new one', async () => {
      mockStatusCounts(0, 0, 0);
      companiesRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Existing' });
      usersRepo.findOne.mockResolvedValue(null);
      membersRepo.findOne.mockResolvedValue(null);

      await service.run(dto());

      expect(companiesRepo.save).not.toHaveBeenCalled();
      expect(membersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ company: { id: 'c1', name: 'Existing' } }),
      );
    });

    it('reuses an existing admin when the password matches (partial state)', async () => {
      mockStatusCounts(0, 0, 0);
      companiesRepo.findOne.mockResolvedValue(null);
      usersRepo.findOne.mockResolvedValue({
        id: 'u1',
        username: 'admin',
        password: bcrypt.hashSync('secreta-123', 4),
      });
      membersRepo.findOne.mockResolvedValue(null);

      await service.run(dto());

      expect(usersRepo.save).not.toHaveBeenCalled();
      expect(membersRepo.save).toHaveBeenCalledTimes(1);
    });

    it('rejects when an existing admin password does not match', async () => {
      mockStatusCounts(0, 0, 0);
      companiesRepo.findOne.mockResolvedValue(null);
      usersRepo.findOne.mockResolvedValue({
        id: 'u1',
        username: 'admin',
        password: bcrypt.hashSync('otra-clave-123', 4),
      });

      await expect(service.run(dto())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(membersRepo.save).not.toHaveBeenCalled();
    });

    it('does not duplicate an existing membership', async () => {
      mockStatusCounts(0, 0, 0);
      companiesRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Existing' });
      usersRepo.findOne.mockResolvedValue(null);
      membersRepo.findOne.mockResolvedValue({ id: 'm1' });

      await service.run(dto());

      expect(membersRepo.save).not.toHaveBeenCalled();
    });

    it('propagates transaction failures so nothing is left half-created', async () => {
      mockStatusCounts(0, 0, 0);
      companiesRepo.findOne.mockResolvedValue(null);
      usersRepo.findOne.mockResolvedValue(null);
      membersRepo.findOne.mockResolvedValue(null);
      membersRepo.save.mockRejectedValue(new Error('insert failed'));

      await expect(service.run(dto())).rejects.toThrow('insert failed');
    });
  });
});
