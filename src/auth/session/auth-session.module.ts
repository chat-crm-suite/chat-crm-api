// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Global, Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { SessionRevocationService } from './session-revocation.service';

/**
 * Global so any service that changes memberships (companies, users, members)
 * can revoke sessions without importing `AuthModule` (which would cycle).
 */
@Global()
@Module({
  imports: [CqrsModule],
  providers: [SessionRevocationService],
  exports: [SessionRevocationService],
})
export class AuthSessionModule {}
