import { ConflictException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PinoLogger } from 'nestjs-pino';
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
    })
  ),
});

describe('SetupService', () => {
  let usersRepo: MockRepo;
  let companiesRepo: MockRepo;
  let membersRepo: MockRepo;
  let whatsappRepo: MockRepo;
  let transaction: jest.Mock;

  const logger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
  };

  const originalSetupToken = process.env.SETUP_TOKEN;
  const originalNodeEnv = process.env.NODE_ENV;

  const dto = (): CreateSetupDto => ({
    admin: { username: 'admin', password: 'secreta-123' },
    company: { name: 'J&P Perifericos' },
  });

  const mockStatusCounts = (
    companies: number,
    admins: number,
    whatsapp: number,
    users = 0
  ) => {
    companiesRepo.count.mockResolvedValue(companies);
    membersRepo.count.mockResolvedValue(admins);
    whatsappRepo.count.mockResolvedValue(whatsapp);
    usersRepo.count.mockResolvedValue(users);
  };

  const build = async (env: {
    SETUP_TOKEN?: string;
    NODE_ENV?: string;
  } = {}): Promise<SetupService> => {
    if (env.SETUP_TOKEN === undefined) {
      delete process.env.SETUP_TOKEN;
    } else {
      process.env.SETUP_TOKEN = env.SETUP_TOKEN;
    }
    process.env.NODE_ENV = env.NODE_ENV ?? 'test';

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
        { provide: PinoLogger, useValue: logger },
      ],
    }).compile();

    return module.get<SetupService>(SetupService);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    usersRepo = createMockRepo();
    companiesRepo = createMockRepo();
    membersRepo = createMockRepo();
    whatsappRepo = createMockRepo();
  });

  afterAll(() => {
    if (originalSetupToken === undefined) delete process.env.SETUP_TOKEN;
    else process.env.SETUP_TOKEN = originalSetupToken;
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('status', () => {
    it('reports a fresh database as not initialized', async () => {
      mockStatusCounts(0, 0, 0, 0);
      const service = await build();

      await expect(service.status()).resolves.toEqual({
        initialized: false,
        hasAdmin: false,
        hasCompany: false,
        hasWhatsapp: false,
        hasUsers: false,
        requiresSetupToken: false,
      });
    });

    it('flags an existing user without an admin membership', async () => {
      // Bootstrap legacy: hay usuario pero ni empresa ni member admin.
      mockStatusCounts(0, 0, 0, 1);
      const service = await build();

      const status = await service.status();

      expect(status.hasUsers).toBe(true);
      expect(status.hasAdmin).toBe(false);
      expect(status.initialized).toBe(false);
    });

    it('is initialized only with company + active admin member', async () => {
      mockStatusCounts(1, 1, 0, 1);
      const service = await build();

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

    it('requires a token when SETUP_TOKEN is configured', async () => {
      mockStatusCounts(0, 0, 0, 0);
      const service = await build({ SETUP_TOKEN: 'super-secreto' });

      await expect(service.status()).resolves.toMatchObject({
        requiresSetupToken: true,
      });
    });

    it('auto-generates and logs a token in production when unset', async () => {
      mockStatusCounts(0, 0, 0, 0);
      const service = await build({ NODE_ENV: 'production' });

      await expect(service.status()).resolves.toMatchObject({
        requiresSetupToken: true,
      });
      expect(logger.info).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ setupToken: expect.any(String) }),
        expect.stringContaining('setup token')
      );
    });

    it('does not require a token outside production when unset', async () => {
      mockStatusCounts(0, 0, 0, 0);
      const service = await build({ NODE_ENV: 'development' });

      await expect(service.status()).resolves.toMatchObject({
        requiresSetupToken: false,
      });
    });
  });

  describe('run (token protection)', () => {
    it('rejects a request without a token when one is required', async () => {
      mockStatusCounts(0, 0, 0, 0);
      const service = await build({ SETUP_TOKEN: 'super-secreto' });

      await expect(service.run(dto())).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects a request with a wrong token', async () => {
      mockStatusCounts(0, 0, 0, 0);
      const service = await build({ SETUP_TOKEN: 'super-secreto' });

      await expect(
        service.run({ ...dto(), setupToken: 'otro' })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('accepts a request with the right token', async () => {
      mockStatusCounts(0, 0, 0, 0);
      companiesRepo.findOne.mockResolvedValue(null);
      usersRepo.findOne.mockResolvedValue(null);
      membersRepo.findOne.mockResolvedValue(null);
      const service = await build({ SETUP_TOKEN: 'super-secreto' });

      await service.run({ ...dto(), setupToken: 'super-secreto' });

      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('provision', () => {
    it('creates user, company, admin membership and whatsapp config atomically', async () => {
      mockStatusCounts(0, 0, 0, 0);
      companiesRepo.findOne.mockResolvedValue(null);
      usersRepo.findOne.mockResolvedValue(null);
      membersRepo.findOne.mockResolvedValue(null);
      const service = await build();

      await service.provision({
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
        })
      );
      expect(whatsappRepo.save).toHaveBeenCalledTimes(1);
    });

    it('skips the whatsapp config when the step is omitted', async () => {
      mockStatusCounts(0, 0, 0, 0);
      companiesRepo.findOne.mockResolvedValue(null);
      usersRepo.findOne.mockResolvedValue(null);
      membersRepo.findOne.mockResolvedValue(null);
      const service = await build();

      await service.provision(dto());

      expect(whatsappRepo.save).not.toHaveBeenCalled();
    });

    it('checks initialization inside the transaction (race fix)', async () => {
      mockStatusCounts(1, 1, 0, 1);
      const service = await build();

      await expect(service.provision(dto())).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('serializes concurrent provision calls', async () => {
      mockStatusCounts(0, 0, 0, 0);
      companiesRepo.findOne.mockResolvedValue(null);
      usersRepo.findOne.mockResolvedValue(null);
      membersRepo.findOne.mockResolvedValue(null);
      const service = await build();

      let running = 0;
      let maxConcurrent = 0;
      transaction.mockImplementation(
        async (cb: (m: unknown) => unknown) => {
          running += 1;
          maxConcurrent = Math.max(maxConcurrent, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          const result = await cb({
            getRepository: (entity: unknown) => {
              if (entity === User) return usersRepo;
              if (entity === Company) return companiesRepo;
              if (entity === Member) return membersRepo;
              if (entity === WhatsAppConfig) return whatsappRepo;
              throw new Error('unexpected entity');
            },
          });
          running -= 1;
          return result;
        }
      );

      await Promise.all([service.provision(dto()), service.provision(dto())]);

      expect(maxConcurrent).toBe(1);
    });

    it('reuses an existing company instead of creating a new one', async () => {
      mockStatusCounts(0, 0, 0, 0);
      companiesRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Existing' });
      usersRepo.findOne.mockResolvedValue(null);
      membersRepo.findOne.mockResolvedValue(null);
      const service = await build();

      await service.provision(dto());

      expect(companiesRepo.save).not.toHaveBeenCalled();
      expect(membersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ company: { id: 'c1', name: 'Existing' } })
      );
    });

    it('reuses an existing admin when the password matches (partial state)', async () => {
      mockStatusCounts(0, 0, 0, 1);
      companiesRepo.findOne.mockResolvedValue(null);
      usersRepo.findOne.mockResolvedValue({
        id: 'u1',
        username: 'admin',
        password: bcrypt.hashSync('secreta-123', 4),
      });
      membersRepo.findOne.mockResolvedValue(null);
      const service = await build();

      await service.provision(dto());

      expect(usersRepo.save).not.toHaveBeenCalled();
      expect(membersRepo.save).toHaveBeenCalledTimes(1);
    });

    it('rejects with a conflict when an existing admin password does not match', async () => {
      mockStatusCounts(0, 0, 0, 1);
      companiesRepo.findOne.mockResolvedValue(null);
      usersRepo.findOne.mockResolvedValue({
        id: 'u1',
        username: 'admin',
        password: bcrypt.hashSync('otra-clave-123', 4),
      });
      const service = await build();

      await expect(service.provision(dto())).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(membersRepo.save).not.toHaveBeenCalled();
    });

    it('does not duplicate an existing membership', async () => {
      mockStatusCounts(0, 0, 0, 0);
      companiesRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Existing' });
      usersRepo.findOne.mockResolvedValue(null);
      membersRepo.findOne.mockResolvedValue({ id: 'm1' });
      const service = await build();

      await service.provision(dto());

      expect(membersRepo.save).not.toHaveBeenCalled();
    });

    it('propagates transaction failures so nothing is left half-created', async () => {
      mockStatusCounts(0, 0, 0, 0);
      companiesRepo.findOne.mockResolvedValue(null);
      usersRepo.findOne.mockResolvedValue(null);
      membersRepo.findOne.mockResolvedValue(null);
      membersRepo.save.mockRejectedValue(new Error('insert failed'));
      const service = await build();

      await expect(service.provision(dto())).rejects.toThrow('insert failed');
    });
  });
});
