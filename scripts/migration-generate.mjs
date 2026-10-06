#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * `migration:generate` wrapper.
 *
 * TypeORM's yargs parser mishandles the command when the extra <path>
 * argument lands after `-d` (which is where pnpm appends it), so this wrapper
 * spawns the CLI with the path in first position.
 *
 * Usage: pnpm migration:generate src/migrations/Name
 */
import { spawnSync } from 'node:child_process';

const name = process.argv.slice(2).join(' ');

if (!name) {
  console.error('Usage: pnpm migration:generate <src/migrations/Name>');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    '--env-file-if-exists=.env',
    './node_modules/typeorm/cli-ts-node-commonjs.js',
    'migration:generate',
    name,
    '-d',
    'data-source.ts',
  ],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
