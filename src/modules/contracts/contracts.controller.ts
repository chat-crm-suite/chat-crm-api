// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get, UseGuards } from '@nestjs/common';

import { AuthGuard } from '@nestjs/passport';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';

import { CONTRACTS_SNAPSHOT } from '../../contracts/generated/snapshot.generated';
import { CONTRACTS_VERSION } from '../../contracts/generated/version.generated';

interface ContractsVersion {
  tag: string;
  commit: string;
  hash: string;
  generatedAt: string;
  files: Record<string, unknown>;
}

/**
 * Publishes the shared-contracts fingerprint over HTTP so any frontend can
 * verify sync from a single URL (dev = localhost, prod = the real host) without
 * a sibling checkout.
 *
 * Guarded by the same JWT as the rest of the API; metadata + schema shapes are
 * not secret but should not be anonymously enumerable.
 */
@ApiTags('Contracts')
@ApiCookieAuth('access_token')
@Controller('contracts')
@UseGuards(AuthGuard('jwt'))
export class ContractsController {
  @Get('version')
  version() {
    const { tag, commit, hash, generatedAt } = CONTRACTS_VERSION as ContractsVersion;

    return { tag, commit, hash, generatedAt };
  }

  @Get('manifest')
  manifest() {
    const { tag, commit, hash, generatedAt, files } =
      CONTRACTS_VERSION as ContractsVersion;

    return { tag, commit, hash, generatedAt, files };
  }

  @Get('snapshot')
  snapshot(): unknown {
    return CONTRACTS_SNAPSHOT;
  }
}
