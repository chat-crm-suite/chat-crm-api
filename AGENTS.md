# AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. See `docs/agents/domain.md`.

### Skill tooling

Project skills are committed under `.agents/skills/`. Run `pnpm skills:sync` to copy them into `.claude/skills/` (local, gitignored) so Claude Code sees them.
