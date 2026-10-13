// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import type { JwtPayload } from '../auth.types';

/** Verified JWT claims of the request (or one claim when `data` is given). */
export const factory = (
  data: keyof JwtPayload | undefined,
  ctx: ExecutionContext,
): JwtPayload | JwtPayload[keyof JwtPayload] | undefined => {
  const request = ctx.switchToHttp().getRequest<Request>();

  const user = request.user as JwtPayload | undefined;

  return data ? user?.[data] : user;
};

export const CurrentUser = createParamDecorator(factory);
