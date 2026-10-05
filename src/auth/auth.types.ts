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
