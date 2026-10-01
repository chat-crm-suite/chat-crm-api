import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';

import { AdminBootstrapService } from './admin-bootstrap.service';
import { UsersService } from '../modules/users/users.service';

describe('AdminBootstrapService', () => {
  let service: AdminBootstrapService;

  const mockUsersService = {
    find: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBootstrapService,
        { provide: UsersService, useValue: mockUsersService },
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
});
