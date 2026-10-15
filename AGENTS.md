# AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. See `docs/agents/domain.md`.

### Skill tooling

Skills are local, not committed: `skills-lock.json` pins them (like `package.json` + lockfile). Fresh clone: `pnpm skills:setup` — restores `.agents/skills` from the lock and copies them into `.claude/skills` for Claude Code. `.agents/` and `.claude/` are gitignored.

### Import style

Canonical terms: **import alias** (a `tsconfig.json` path mapping), **deep
relative path** (an import with 3+ `../`), **sibling relative** (`./`, `../`,
`../../`).

- **Policy**: deep relative paths (3+ `../`) must use an import alias.
  Sibling relatives stay relative — they keep the local file graph obvious.
- **Enforcement**: the `@limegrass/import-alias/import-alias` ESLint rule
  (error severity) rewrites deep relatives to aliases with `--fix`. Run
  `pnpm lint` to convert; the editor fixes on save via `fixAll.eslint`.
- **Aliases**: `@contracts`, `@config`, `@common`, `@strategies`, `@docs`,
  `@scripts`, `@helpers`, `@src/*`, plus the existing `@modules`,
  `@modules/*`, `@auth`, `@auth/*`, `@entities`, `@lib/*`, `@utils/*`,
  `@core/*`, `@integrations/*`, `@factories`. No `@types/*` (collides with
  the npm `@types/*` scope).
- **Single source of truth**: `tsconfig.json` drives the IDE, Jest unit
  (`jest.config.cjs`), Jest e2e (`test/jest-e2e.cjs`) and the Nest build.
- **Never compile with bare `tsc`** — it does not pass through the Nest CLI's
  path-rewriting hook and leaves `dist` with unresolvable `require("@...")`
  specifiers. Use `pnpm typecheck` (`tsc --noEmit -p tsconfig.typecheck.json`,
  scoped to `src/` production code) or `pnpm build` (which is safe).
- **`ts-node` scripts** that import aliases need `-r tsconfig-paths/register`
  (the same hook the Nest CLI uses at build time).

See ADR `0002-tsconfig-path-aliases` for why this works and the alternatives
that were rejected.

## Environment

Env files (`.env`, `.env.prod`) carry only the 17 API variables in use. Fill the
secrets with `./deploy/gen-secrets.sh [--env FILE] [--prune] [--show-setup-token]
[--show-platform-password] [--rotate KEY[,KEY]] [--yes-db]`.

- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` and the `MYSQL_*` mirrors (`MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`)
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `JWT_SECRET`, `CORS_ORIGIN`, `CREDENTIALS_ENCRYPTION_KEY`, `SETUP_TOKEN`
- `PLATFORM_CONSOLE_PASSWORD` (17th, opt-in): enables the superadmin console.
  - Unset, empty or `disabled`: the console is off and every `/platform/*` route answers 404 (`GET /platform/status` still answers 200 with `enabled:false`).
  - Set: a user with `users.is_platform_admin` calls `POST /platform/unlock` with this password (compared in constant time, 5 failures per 15 min per user, then 429) and gets the httpOnly `platform_token` cookie (30 min, `SameSite=Strict`, `Secure` with `COOKIE_SECURE=1`). The token is a JWT with `aud: 'platform'` signed with a key derived from `JWT_SECRET`, so an access token never works as a platform token. `PlatformGuard` guards `/platform/companies/*`: valid token, same user as the session, still a platform admin, else 403 `platform_locked`.
  - `gen-secrets.sh` generates it (48 hex chars) and never overwrites a strong value; write `PLATFORM_CONSOLE_PASSWORD=disabled` to keep the console off.
- Optional with code defaults: `COOKIE_SECURE`, `SWAGGER_ENABLED`, `IA_URL`, `APP_TZ`, `HEALTH_PROBE_TTL_MS`, `HEALTH_IA_TIMEOUT_MS`.
