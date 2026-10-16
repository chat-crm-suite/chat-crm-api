// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Explicit migration runner for production deploys.
 *
 * Usage (inside the production image, before starting the app; compose file
 * from the chat-crm-deploy repo):
 *   docker compose -f deploy/docker-compose.yml run --rm api \
 *     node dist/scripts/run-migrations.js
 *
 * Prefer this over boot-time `migrationsRun`: a failure here is diagnosable
 * and does not leave the app in a boot loop.
 */
import { DataSource } from 'typeorm';

async function main(): Promise<void> {
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    migrations: [__dirname + '/../migrations/*.js'],
    migrationsTableName: 'migrations',
    logging: ['error', 'warn'],
  });

  await dataSource.initialize();
  const executed = await dataSource.runMigrations();
  await dataSource.destroy();

  console.log(`[run-migrations] applied ${executed.length} migration(s)`);
}

void main().catch((error: unknown) => {
  console.error('[run-migrations] failed', error);
  process.exit(1);
});
