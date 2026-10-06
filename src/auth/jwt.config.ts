// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Single source for the JWT secret. HTTP auth (`JwtModule.register`), the
 * socket handshake (`ConversationsModule`) and the strategy verification
 * (`JwtStrategy`) must all read the same value, including the dev fallback.
 */
export const JWT_SECRET_FALLBACK = 'your_jwt_secret';

export function getJwtSecret(): string {
  return process.env.JWT_SECRET || JWT_SECRET_FALLBACK;
}
