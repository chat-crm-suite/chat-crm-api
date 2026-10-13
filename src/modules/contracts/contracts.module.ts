// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';

import { ContractsController } from './contracts.controller';

/**
 * Serves the generated contracts snapshot/version. No providers or database
 * dependencies: the data is baked at build time (`contracts:snapshot`).
 */
@Module({
  controllers: [ContractsController],
})
export class ContractsModule {}
