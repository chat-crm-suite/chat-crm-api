// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { UsersService } from '@modules/users/users.service';
import { Payload } from '@auth';
import { IdentifyGuard } from './identify.guard';
import { UserFactory } from '@factories';

describe('IdentifyGuard', () => {
  let guard: IdentifyGuard;

  const mockUsersService = {
    identify: jest.fn(),
  };

  const mockUser = UserFactory.build();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentifyGuard,
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    guard = module.get<IdentifyGuard>(IdentifyGuard);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access and attach user to request', () => {
    const mockPayload: Payload = { sub: '123' } as unknown as Payload;
    const mockRequest = {
      user: mockPayload,
    };

    const mockExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;

    mockUsersService.identify.mockReturnValue(mockUser);

    const result = guard.canActivate(mockExecutionContext);

    expect(result).toBe(true);
    expect(mockUsersService.identify).toHaveBeenCalled();
    expect(mockRequest.user).toBe(mockUser);
  });

  it('should handle different payload sub values', () => {
    const mockPayload: Payload = { sub: '456' } as unknown as Payload;
    const mockRequest = {
      user: mockPayload,
    };

    const mockExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;

    const differentUser = { ...mockUser, id: '456' };
    mockUsersService.identify.mockReturnValue(differentUser);

    void guard.canActivate(mockExecutionContext);

    expect(mockUsersService.identify).toHaveBeenCalled();
    expect(mockRequest.user).toBe(differentUser);
  });
});