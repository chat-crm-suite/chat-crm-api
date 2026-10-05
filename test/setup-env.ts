import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Jest `setupFiles` entry: loads the repo-root `.env` so `pnpm test` and
 * `pnpm test:e2e` work without exporting the DB and REDIS variables manually.
 *
 * `process.loadEnvFile` is not usable here: Jest runs tests with a sandboxed
 * `process.env` copy, so the native loader would mutate the real env instead.
 * Parsed with plain Node (no dotenv dependency); existing environment
 * variables always win, so `DB_HOST=127.0.0.1 ... jest` still overrides.
 */
const envPath = resolve(__dirname, '..', '.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);

    process.env[key] = value;
  }
}
