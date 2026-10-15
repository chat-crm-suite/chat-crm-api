// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  canCreateMember,
  canManage,
  wouldLeaveWithoutAdmin,
} from './team.policy';

const admin = { memberId: 'a1', role: 'admin' as const };
const supervisor = { memberId: 's1', role: 'supervisor' as const };
const agent = { memberId: 'g1', role: 'agent' as const };

describe('team policy', () => {
  describe('canCreateMember', () => {
    it.each(['admin', 'supervisor', 'agent'] as const)(
      'lets an admin add a %s',
      (role) => {
        expect(canCreateMember(admin, role)).toEqual({ allowed: true });
      },
    );

    it('lets a supervisor add agents only', () => {
      expect(canCreateMember(supervisor, 'agent')).toEqual({ allowed: true });
      expect(canCreateMember(supervisor, 'supervisor')).toEqual({
        allowed: false,
        reason: 'grant',
      });
      expect(canCreateMember(supervisor, 'admin')).toEqual({
        allowed: false,
        reason: 'grant',
      });
    });

    it('denies an agent everything', () => {
      expect(canCreateMember(agent, 'agent')).toEqual({
        allowed: false,
        reason: 'role',
      });
    });
  });

  describe('canManage', () => {
    it('lets an admin manage any other member and set any role', () => {
      for (const role of ['admin', 'supervisor', 'agent'] as const) {
        expect(canManage(admin, { memberId: 'x', role }, { role: 'admin' })).toEqual({
          allowed: true,
        });
      }
    });

    it('lets a supervisor manage agents without promoting them', () => {
      const target = { memberId: 'x', role: 'agent' as const };

      expect(canManage(supervisor, target)).toEqual({ allowed: true });
      expect(canManage(supervisor, target, { role: 'agent' })).toEqual({
        allowed: true,
      });
      expect(canManage(supervisor, target, { role: 'supervisor' })).toEqual({
        allowed: false,
        reason: 'grant',
      });
    });

    it('keeps a supervisor away from supervisors and admins', () => {
      for (const role of ['admin', 'supervisor'] as const) {
        expect(canManage(supervisor, { memberId: 'x', role })).toEqual({
          allowed: false,
          reason: 'role',
        });
      }
    });

    it('denies an agent', () => {
      expect(canManage(agent, { memberId: 'x', role: 'agent' })).toEqual({
        allowed: false,
        reason: 'role',
      });
    });

    it('never lets anybody act on themselves', () => {
      for (const actor of [admin, supervisor, agent]) {
        expect(canManage(actor, actor)).toEqual({ allowed: false, reason: 'self' });
      }
    });
  });

  describe('wouldLeaveWithoutAdmin', () => {
    const activeAdmin = { role: 'admin' as const, status: 'active' as const };

    it('blocks demoting, suspending or removing the last active admin', () => {
      expect(wouldLeaveWithoutAdmin(activeAdmin, { role: 'agent' }, 1)).toBe(true);
      expect(wouldLeaveWithoutAdmin(activeAdmin, { status: 'suspended' }, 1)).toBe(true);
      expect(wouldLeaveWithoutAdmin(activeAdmin, { status: 'inactive' }, 1)).toBe(true);
      expect(wouldLeaveWithoutAdmin(activeAdmin, { removed: true }, 1)).toBe(true);
    });

    it('allows it while another active admin remains', () => {
      expect(wouldLeaveWithoutAdmin(activeAdmin, { role: 'agent' }, 2)).toBe(false);
      expect(wouldLeaveWithoutAdmin(activeAdmin, { removed: true }, 2)).toBe(false);
    });

    it('allows edits that keep the admin active', () => {
      expect(wouldLeaveWithoutAdmin(activeAdmin, {}, 1)).toBe(false);
      expect(
        wouldLeaveWithoutAdmin(activeAdmin, { role: 'admin', status: 'active' }, 1),
      ).toBe(false);
    });

    it('ignores members that are not active admins', () => {
      expect(
        wouldLeaveWithoutAdmin({ role: 'agent', status: 'active' }, { removed: true }, 1),
      ).toBe(false);
      expect(
        wouldLeaveWithoutAdmin({ role: 'admin', status: 'suspended' }, { removed: true }, 1),
      ).toBe(false);
    });
  });
});
