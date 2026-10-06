// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { AuthUser as AuthUserContract } from '../contracts/index';

/** `GET /auth/me` / `GET /users/me` shape (identity + memberships). */
export type AuthUser = AuthUserContract;

export type JwtPayload = {
  sub: string;
  company: string;
};

export type AuthResponse = {
  access_token: string;
  payload: JwtPayload;
};
