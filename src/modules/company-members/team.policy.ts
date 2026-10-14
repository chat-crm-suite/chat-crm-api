// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { MemberRole, MemberStatus } from '../../contracts/index';

/**
 * Who may manage whom in Equipo. Pure functions: the service applies them
 * inside its transactions and the front keeps a copy to disable menu items.
 *
 * - admin: any member, any role;
 * - supervisor: only `agent` members, and never grants another role;
 * - agent: nothing;
 * - nobody acts on themselves through the team endpoints (own data lives in
 *   the profile screen), so nobody can lock themselves out.
 *
 * The last active admin of a company is protected separately
 * (`wouldLeaveWithoutAdmin`) because it needs a count taken in the transaction.
 */
export type TeamActor = { memberId: string; role: MemberRole };
export type TeamTarget = { memberId: string; role: MemberRole };

export type TeamDenial = 'self' | 'role' | 'grant';
export type TeamDecision =
  | { allowed: true }
  | { allowed: false; reason: TeamDenial };

const ALLOWED: TeamDecision = { allowed: true };
const deny = (reason: TeamDenial): TeamDecision => ({ allowed: false, reason });

/** Whether the actor may add a member with `role` to the company. */
export function canCreateMember(actor: TeamActor, role: MemberRole): TeamDecision {
  if (actor.role === 'admin') return ALLOWED;
  if (actor.role === 'supervisor') {
    return role === 'agent' ? ALLOWED : deny('grant');
  }

  return deny('role');
}

/**
 * Whether the actor may edit, suspend, reset the password of or delete
 * `target`. `change.role` is the role the edit would assign, if any.
 */
export function canManage(
  actor: TeamActor,
  target: TeamTarget,
  change: { role?: MemberRole } = {},
): TeamDecision {
  if (actor.memberId === target.memberId) return deny('self');
  if (actor.role === 'admin') return ALLOWED;
  if (actor.role !== 'supervisor') return deny('role');
  if (target.role !== 'agent') return deny('role');
  if (change.role && change.role !== 'agent') return deny('grant');

  return ALLOWED;
}

/**
 * Whether the change would leave the company without an active admin.
 * `activeAdmins` is the count taken inside the transaction.
 */
export function wouldLeaveWithoutAdmin(
  target: { role: MemberRole; status: MemberStatus },
  change: { role?: MemberRole; status?: MemberStatus; removed?: boolean },
  activeAdmins: number,
): boolean {
  const isActiveAdmin = target.role === 'admin' && target.status === 'active';
  if (!isActiveAdmin) return false;

  const stillAdmin =
    !change.removed &&
    (change.role ?? target.role) === 'admin' &&
    (change.status ?? target.status) === 'active';

  return !stillAdmin && activeAdmins <= 1;
}
