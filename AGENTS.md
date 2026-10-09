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
