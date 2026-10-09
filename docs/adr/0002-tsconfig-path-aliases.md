# ADR 0002 — Import aliases as the single source of truth for module paths

- Status: Accepted (2026-10)
- Tickets: #27 (spec; implemented by #28–#33)
- Code: `tsconfig.json`, `tsconfig.typecheck.json`, `eslint.config.mjs`,
  `test/jest-e2e.cjs`, `src/**`

## Context

Imports in `src/` used long relative paths: 526 ascending relative imports, of
which 157 were "deep" (3+ `../`, up to 4). Examples like
`import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity'` hurt
readability, make refactors noisy, and hide which folder an import comes from.
Path aliases already existed in `tsconfig.json` (`@modules`, `@auth`,
`@entities`, `@lib`, `@utils`, `@core`, `@integrations`, `@factories`) but
were almost unused (8 of 526), and the most-needed ones (`@contracts`,
`@config`, `@common`, `@strategies`) were missing entirely. Nothing enforced
or assisted the alias choice, so new imports kept being written as relatives.

The decisive discovery: `nest build` and `nest start --watch` rewrite path
aliases to relative paths at emit time via `@nestjs/cli`'s
`tsconfig-paths.hook` (an AST transform registered as a compiler `before`
hook). Bare `tsc` does **not** — it emits `require("@modules")` and the app
crashes at runtime. Jest unit maps aliases via `pathsToModuleNameMapper`; Jest
e2e had them hardcoded. Production (`node dist/main`) is safe only because of
that hook.

## Decision

Make `tsconfig.json` the single source of truth for module paths, and enforce
it with a fixable lint rule.

- **Aliases**: add `@contracts`, `@config`, `@common`, `@strategies`, `@docs`,
  `@scripts`, `@helpers`, `@src/*` (catch-all). No `@types/*` (collides with
  the npm `@types/*` scope). Nest modules live under a single root
  `@modules/<module>/...`.
- **Policy**: deep relative paths (3+ `../`) must use an alias; sibling
  relatives (`./`, `../`, `../../`) stay relative. This converts exactly the
  157 deep imports and preserves 375 sibling imports.
- **Enforcement**: the `@limegrass/import-alias/import-alias` ESLint rule
  (error severity, non-type-aware block) rewrites deep relatives to aliases
  with `--fix`. The migration is one `pnpm lint` run; the editor fixes on save.
- **Tooling**: `test/jest-e2e.cjs` derives its alias map from the tsconfig
  (same formula as `jest.config.cjs`); a `pnpm typecheck` script
  (`tsc --noEmit -p tsconfig.typecheck.json`, scoped to `src/` production code)
  validates types without emitting a broken `dist/`.
- **Docs**: *Import style* section in `AGENTS.md` with the canonical terms
  (import alias, deep relative path, sibling relative).

### Alternatives considered

- **`tsc-alias` post-build**: rewrites aliases after `tsc`. Rejected — adds a
  build step and a dependency when the Nest CLI already does this for free.
- **`tsconfig-paths/register` at runtime**: lets Node resolve aliases directly.
  Rejected — the tsconfig paths point at `src/`, not `dist/`, so it would need
  a second config for production; the Nest hook is simpler and already present.
- **Stay on relative paths**: rejected — the problem is exactly that relatives
  are long and unstable.
- **Custom ESLint rule**: kept as fallback. The external plugin passed the spike
  (only touches 3+ levels, build stays clean, no `baseUrl` needed), so it was
  preferred over writing and maintaining our own.
- **New barrels (`export * as`)**: rejected — they force runtime loading of
  every module in the barrel and are the classic route to circular imports in
  Nest DI.
- **Bounded-context lint guards** (`import/no-restricted-paths`): out of scope
  for this change; separate topic, possibly its own ADR.

## Consequences

- Imports are short and stable under file moves.
- The alias map has one source of truth; the IDE, both Jest configs and the
  Nest build stay in sync automatically.
- The lint rule prevents regressions and converts future deep relatives on
  save.
- Two guardrails are documented in `AGENTS.md`: never compile with bare
  `tsc`, and `ts-node` scripts need `-r tsconfig-paths/register` if they
  import aliases.
