// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { CompanyMembersModule } from '../modules/company-members/company-members.module';
import { AuthController } from './auth.controller';
import { UsersModule } from '@modules';
import { SetupModule } from '../modules/setup/setup.module';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { getJwtSecret, JWT_EXPIRES_IN_SECONDS } from './jwt.config';
import { JwtAuthGuard, RolesGuard, TenantGuard } from './guards/index';
import { AuthSessionModule } from './session/auth-session.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: JWT_EXPIRES_IN_SECONDS },
    }),
    CompanyMembersModule,
    SetupModule,
    AuthSessionModule,
  ],
  providers: [
    AuthService,
    JwtStrategy,
    AdminBootstrapService,
    // Order matters: session, then tenant, then the role inside that tenant.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  controllers: [AuthController],
})
export class AuthModule {}
