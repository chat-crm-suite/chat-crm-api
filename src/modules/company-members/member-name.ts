// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/** The user fields a member's display name is built from. */
export interface MemberNameSource {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/** "First Last" when the profile has it, else the username (never empty). */
export function memberDisplayName(user: MemberNameSource | null | undefined): string {
  const full = [user?.firstName, user?.lastName]
    .filter((part): part is string => !!part && !!part.trim())
    .map((part) => part.trim())
    .join(' ');

  return full || user?.username || 'Unknown';
}
