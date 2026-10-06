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
