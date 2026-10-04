import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';

import { UsersService } from '../modules/users/users.service';
import { SetupService } from '../modules/setup/setup.service';
import { AdminBootstrapService } from './admin-bootstrap.service';

describe('AdminBootstrapService', () => {
  let service: AdminBootstrapService;

  const mockUsersService = {
    find: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const mockSetupService = {
    status: jest.fn(),
    provision: jest.fn(),
  };

  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
  };

  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    delete process.env.BOOTSTRAP_COMPANY_NAME;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_WEBHOOK_URL;
    delete process.env.WHATSAPP_BUSINESS_ID;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBootstrapService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: SetupService, useValue: mockSetupService },
        { provide: PinoLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<AdminBootstrapService>(AdminBootstrapService);
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does nothing when a user already exists', async () => {
    mockUsersService.find.mockResolvedValue({ id: 'existing-user' });

    await service.onApplicationBootstrap();

    expect(mockUsersService.create).not.toHaveBeenCalled();
    expect(mockUsersService.find).toHaveBeenCalledWith({});
  });

  it('skips when BOOTSTRAP_ADMIN_* is not set', async () => {
    mockUsersService.find.mockResolvedValue(null);

    await service.onApplicationBootstrap();

    expect(mockUsersService.create).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('skipping admin bootstrap'),
    );
  });

  it('creates the admin when the table is empty and env is set', async () => {
    mockUsersService.find.mockResolvedValue(null);
    mockUsersService.create.mockResolvedValue({ id: 'new-admin-id' });
    process.env.BOOTSTRAP_ADMIN_USERNAME = 'admin';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'secreta-123';

    await service.onApplicationBootstrap();

    expect(mockUsersService.create).toHaveBeenCalledWith({
      username: 'admin',
      password: 'secreta-123',
    });
    expect(mockUsersService.update).toHaveBeenCalledWith('new-admin-id', {
      role: 'admin',
    });
  });

  it('rejects a shorter than 8 chars password', async () => {
    mockUsersService.find.mockResolvedValue(null);
    process.env.BOOTSTRAP_ADMIN_USERNAME = 'admin';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'corta';

    await service.onApplicationBootstrap();

    expect(mockUsersService.create).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('at least 8 characters'),
    );
  });

  it('logs instead of crashing the boot when create fails', async () => {
    mockUsersService.find.mockResolvedValue(null);
    process.env.BOOTSTRAP_ADMIN_USERNAME = 'admin';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'secreta-123';
    mockUsersService.create.mockRejectedValue(new Error('db down'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalledWith(
      // expect.any() returns `any` — safe in test assertion context
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('failed'),
    );
  });

  describe('headless company provisioning', () => {
    it('does nothing when BOOTSTRAP_COMPANY_NAME is not set', async () => {
      mockUsersService.find.mockResolvedValue({ id: 'existing-user' });

      await service.onApplicationBootstrap();

      expect(mockSetupService.status).not.toHaveBeenCalled();
      expect(mockSetupService.provision).not.toHaveBeenCalled();
    });

    it('provisions company + admin membership when the app is not initialized', async () => {
      mockUsersService.find.mockResolvedValue({ id: 'existing-user' });
      mockSetupService.status.mockResolvedValue({ initialized: false });
      mockSetupService.provision.mockResolvedValue({
        user: { id: 'existing-user', username: 'admin' },
        company: { id: 'c1', name: 'J&P' },
        whatsapp: null,
      });
      process.env.BOOTSTRAP_COMPANY_NAME = 'J&P';
      process.env.BOOTSTRAP_ADMIN_USERNAME = 'admin';
      process.env.BOOTSTRAP_ADMIN_PASSWORD = 'secreta-123';

      await service.onApplicationBootstrap();

      expect(mockSetupService.provision).toHaveBeenCalledWith({
        admin: { username: 'admin', password: 'secreta-123' },
        company: { name: 'J&P' },
        whatsapp: undefined,
      });
    });

    it('skips provisioning when the app is already initialized', async () => {
      mockUsersService.find.mockResolvedValue({ id: 'existing-user' });
      mockSetupService.status.mockResolvedValue({ initialized: true });
      process.env.BOOTSTRAP_COMPANY_NAME = 'J&P';
      process.env.BOOTSTRAP_ADMIN_USERNAME = 'admin';
      process.env.BOOTSTRAP_ADMIN_PASSWORD = 'secreta-123';

      await service.onApplicationBootstrap();

      expect(mockSetupService.provision).not.toHaveBeenCalled();
    });

    it('passes whatsapp credentials when the env is complete', async () => {
      mockUsersService.find.mockResolvedValue({ id: 'existing-user' });
      mockSetupService.status.mockResolvedValue({ initialized: false });
      mockSetupService.provision.mockResolvedValue({
        user: { id: 'existing-user', username: 'admin' },
        company: { id: 'c1', name: 'J&P' },
        whatsapp: { id: 'wa-1' },
      });
      process.env.BOOTSTRAP_COMPANY_NAME = 'J&P';
      process.env.BOOTSTRAP_ADMIN_USERNAME = 'admin';
      process.env.BOOTSTRAP_ADMIN_PASSWORD = 'secreta-123';
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-1';
      process.env.WHATSAPP_ACCESS_TOKEN = 'token';
      process.env.WHATSAPP_WEBHOOK_URL =
        'http://localhost:3000/integration/webhook/whatsapp';
      process.env.WHATSAPP_BUSINESS_ID = 'biz-1';

      await service.onApplicationBootstrap();

      expect(mockSetupService.provision).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          whatsapp: expect.objectContaining({
            businessId: 'biz-1',
            accessToken: 'token',
            phoneNumberId: 'phone-1',
            webhookUrl: 'http://localhost:3000/integration/webhook/whatsapp',
          }),
        }),
      );
    });

    it('logs instead of crashing when provisioning fails', async () => {
      mockUsersService.find.mockResolvedValue({ id: 'existing-user' });
      mockSetupService.status.mockResolvedValue({ initialized: false });
      mockSetupService.provision.mockRejectedValue(new Error('setup failed'));
      process.env.BOOTSTRAP_COMPANY_NAME = 'J&P';
      process.env.BOOTSTRAP_ADMIN_USERNAME = 'admin';
      process.env.BOOTSTRAP_ADMIN_PASSWORD = 'secreta-123';

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('failed'),
      );
    });
  });
});
