// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../auth.types';
import { Request } from 'express';

export const factory = (
  data: keyof AuthUser | undefined,
  ctx: ExecutionContext
): AuthUser | AuthUser[keyof AuthUser] | undefined => {
  const request = ctx.switchToHttp().getRequest<Request>();

  const user = request.user as AuthUser;

  return data ? user[data] : user;
}

export const CurrentUser = createParamDecorator(factory);