// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Recreates the current database from scratch (dev/staging only): drops every
 * table and runs all migrations. The application bootstrap
 * (`AdminBootstrapService`) provisions the initial admin/company on next boot;
 * it is idempotent.
 *
 * Uso (desde chat-crm-api/):
 *   pnpm db:reset
 *
 * Requires DB_* in the environment or a .env at the repo root; the npm script
 * loads it with `--env-file-if-exists`.
 */
import 'reflect-metadata';

import dataSource from '../data-source';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:reset refuses to run with NODE_ENV=production');
  }

  await dataSource.initialize();

  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.clearDatabase();
  await queryRunner.release();

  await dataSource.runMigrations();
  await dataSource.destroy();

  console.log('[db:reset] schema recreated from migrations');
}

main().catch((error) => {
  console.error('[db:reset] failed', error);
  process.exitCode = 1;
});
