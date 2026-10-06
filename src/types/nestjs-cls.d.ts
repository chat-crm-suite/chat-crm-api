// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import 'nestjs-cls';

declare module "nestjs-cls" {
  interface ClsStore {
    company?: { id: string };
    user?: { id: string };
  }
}
