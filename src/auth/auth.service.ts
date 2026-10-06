// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../modules/users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
  ) { }

  async valid(pass: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(pass, hash)
  }

  async sign(credentials: { username: string, password: string }): Promise<string> {
    const user = await this.userService.find({ username: credentials.username });

    if (!user || !(await this.valid(credentials.password, user.passwordHash))) throw new UnauthorizedException();

    const payload = {
      sub: user.id,
      company: 'no implemented yet'
    };

    const token = await this.jwtService.signAsync(payload);

    return token;
  }

  refresh() {
    // TODO: implement refresh token logic
    return { message: 'Not implemented' }
  }
}
