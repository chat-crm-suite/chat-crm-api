// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import 'nestjs-cls';

import type { MemberRole } from '../contracts/index';

// Nested on purpose: nestjs-cls resolves dotted keys ('company.id') as paths.
declare module "nestjs-cls" {
  interface ClsStore {
    company?: { id?: string };
    user?: { id?: string };
    member?: { id?: string; role?: MemberRole };
  }
}
