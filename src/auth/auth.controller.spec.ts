import { Response } from 'express';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AuthUser } from '@auth';
import { IdentifyGuard } from './guards/identify.guard';
import { CompanyMemberService } from '../modules/company-members/company-member.service';

describe('AuthController', () => {
  let controller: AuthController;
  let res: jest.Mocked<Response>;

  const mockUser: AuthUser = {
    id: 'user-1',
    username: 'jeremi',
    firstName: 'Jeremi',
    lastName: null,
    avatarUrl: null,
    email: null,
    phoneNumber: null,
    isPlatformAdmin: false,
    memberships: [
      {
        companyId: 'company-1',
        companyName: 'J&P Perifericos',
        role: 'admin',
        status: 'active',
      },
    ],
  };

  const mocks = {
    authService: {
      sign: jest.fn(),
    },
    identityGuard: {
      canActivate: jest.fn(),
    },
    companyMembers: {
      getCompanies: jest.fn(),
    },
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mocks.authService,
        },
        {
          provide: CompanyMemberService,
          useValue: mocks.companyMembers,
        },
      ],
    })
      .overrideGuard(IdentifyGuard)
      .useValue(mocks.identityGuard)
      .compile();

    controller = module.get<AuthController>(AuthController);

    res = {
      cookie: mocks.cookie,
      clearCookie: mocks.clearCookie,
    } as unknown as jest.Mocked<Response>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should call AuthService.sign and set cookie', async () => {
      const dto: LoginDto = { username: 'jeremi', password: '1234' };

      mocks.authService.sign.mockResolvedValue('fake-token');

      const result = await controller.login(dto, res);

      expect(mocks.authService.sign).toHaveBeenCalledWith(dto);
      expect(mocks.cookie).toHaveBeenCalledWith(
        'access_token',
        'fake-token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(result).toEqual({
        message: 'Login Success',
      });
    });
  });

  describe('logout', () => {
    it('should clear cookie and return message', () => {
      const result = controller.logout(res);

      expect(mocks.clearCookie).toHaveBeenCalledWith('access_token');
      expect(result).toEqual({ message: 'Logout success' });
    });
  });

  describe('getProfile', () => {
    it('should return the user and the first company id', async () => {
      mocks.companyMembers.getCompanies.mockResolvedValue([
        'company-1',
        'company-2',
      ]);

      const result = await controller.getProfile(mockUser);

      expect(result).toEqual({
        user: mockUser,
        company: { id: 'company-1' },
      });
    });

    it('should return null company when the user has none', async () => {
      mocks.companyMembers.getCompanies.mockResolvedValue([]);

      const result = await controller.getProfile(mockUser);

      expect(result).toEqual({
        user: mockUser,
        company: { id: null },
      });
    });
  });
});
