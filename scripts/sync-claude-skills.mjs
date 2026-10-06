#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Copy the committed skills (`.agents/skills`) into Claude Code's project
 * directory (`.claude/skills`, gitignored) so Claude sees them on any clone.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const source = join(root, '.agents', 'skills');
const target = join(root, '.claude', 'skills');

if (!existsSync(source)) {
  console.error(
    `No skills found at ${source} — run \`pnpm skills:install\` first.`,
  );
  process.exit(1);
}

mkdirSync(target, { recursive: true });

const skills = readdirSync(source, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

for (const name of skills) {
  const destination = join(target, name);
  const existing = lstatSync(destination, { throwIfNoEntry: false });

  if (existing?.isSymbolicLink()) {
    unlinkSync(destination);
  } else if (existing) {
    rmSync(destination, { recursive: true, force: true });
  }

  cpSync(join(source, name), destination, { recursive: true });
}

console.log(`Synced ${skills.length} skills to .claude/skills`);
