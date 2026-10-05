import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { NestFactory } from '@nestjs/core';

import { buildOpenApiDocument } from '../docs/openapi';

/**
 * Generates (or checks) `openapi.json` from the Nest application.
 *
 * Usage:
 *   pnpm run docs:gen     # writes openapi.json at the repo root
 *   pnpm run docs:check   # exits with code 1 when openapi.json is stale
 *
 * `DB_DRIVER=sqlite` boots the TypeORM connection against in-memory SQLite, so
 * the document can be generated without MySQL/Redis (dedicated tooling run).
 */
async function main(): Promise<void> {
  const check = process.argv.includes('--check');

  process.env.DB_DRIVER = 'sqlite';

  // Dynamic import: the env above must be set before the config modules load.
  const { AppModule } = await import('../app.module.js');

  // `logger: ['error']`: silent boot, but bootstrap failures stay visible.
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  const document = buildOpenApiDocument(app);
  await app.close();

  const target = join(process.cwd(), 'openapi.json');
  const serialized = `${JSON.stringify(document, null, 2)}\n`;

  if (check) {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';

    if (current !== serialized) {
      console.error(
        'openapi.json is out of date. Run `pnpm run docs:gen` and commit the result.',
      );
      process.exit(1);
    }

    console.log('openapi.json is up to date.');
    return;
  }

  writeFileSync(target, serialized, 'utf8');
  console.log(`Wrote ${target}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
