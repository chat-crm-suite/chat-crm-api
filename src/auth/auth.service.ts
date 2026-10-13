// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../modules/users/users.service';
import { CompanyMemberService } from '../modules/company-members/company-member.service';
import type { JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
    private readonly companyMembers: CompanyMemberService,
  ) {}

  async valid(pass: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(pass, hash);
  }

  /** Checks the credentials and issues an access token with the user's memberships. */
  async sign(credentials: { username: string; password: string }): Promise<string> {
    const user = await this.userService.find({ username: credentials.username });

    if (!user || !(await this.valid(credentials.password, user.passwordHash))) {
      throw new UnauthorizedException();
    }

    return this.issueToken(user.id);
  }

  /**
   * Signs a token for an existing (not soft-deleted) user, embedding the
   * current active memberships so the tenant guard validates in memory.
   */
  async issueToken(userId: string): Promise<string> {
    const user = await this.userService.findOne(userId);
    if (!user) throw new UnauthorizedException();

    const payload: JwtPayload = {
      sub: user.id,
      memberships: await this.companyMembers.findActiveClaims(user.id),
      ts: Date.now(),
    };

    return this.jwtService.signAsync(payload);
  }

  /**
   * Reissues a token from a current one whose memberships may be stale. Only
   * the signature and expiry are checked here: staleness is exactly what this
   * call repairs, and the memberships are reloaded from the database.
   */
  async refreshMemberships(token: string | undefined): Promise<{ token: string; userId: string }> {
    if (!token) throw new UnauthorizedException();

    let payload: Partial<JwtPayload>;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (!payload.sub) throw new UnauthorizedException();

    return { token: await this.issueToken(payload.sub), userId: payload.sub };
  }
}
