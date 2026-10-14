// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { EntityManager, Repository } from 'typeorm';

import type {
  MemberCreateOutcome,
  MemberRole,
} from '../../contracts/index';
import { generateInitialPassword } from '../../lib/helpers/generate-password.helper';
import { User } from '../users/entities/user.entity';
import { CompanyMember } from './entities/company-member.entity';

export type ProvisionMemberInput = {
  companyId: string;
  email: string;
  role: MemberRole;
  username?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  acceptsAutoAssign?: boolean;
  maxOpenConversations?: number | null;
  /** Member that adds this one (audit); null for the platform console. */
  createdByMemberId?: string | null;
};

export type ProvisionMemberResult = {
  member: CompanyMember;
  user: User;
  outcome: MemberCreateOutcome;
  /** Only when the account was created; the caller shows it once. */
  initialPassword?: string;
};

const MAX_USERNAME_SUFFIX = 50;

/**
 * The single "add a person to a company" rule, shared by the team screen and
 * the platform console (first admin of a new company):
 *
 * - the email of an existing account links it (its password is untouched);
 * - otherwise the account is created with a generated password;
 * - a soft-deleted membership of the same account is restored, not duplicated;
 * - an active membership is a conflict.
 *
 * Runs inside the caller's transaction (`manager`), so a failure never leaves
 * an account without membership. Callers revoke the user's sessions after the
 * commit so the token picks up the new membership.
 */
@Injectable()
export class MemberProvisioningService {
  async provision(
    manager: EntityManager,
    input: ProvisionMemberInput,
  ): Promise<ProvisionMemberResult> {
    const email = input.email.trim().toLowerCase();
    const users = manager.getRepository(User);
    const members = manager.getRepository(CompanyMember);

    let user = await users.findOne({ where: { email }, withDeleted: true });
    let initialPassword: string | undefined;

    if (user?.deletedAt) {
      throw new ConflictException({
        code: 'account_disabled',
        message: 'This account was disabled and cannot be added',
      });
    }

    if (!user) {
      initialPassword = generateInitialPassword();
      user = await users.save(
        users.create({
          email,
          username: await this.freeUsername(users, input.username, email),
          passwordHash: await bcrypt.hash(initialPassword, 10),
          firstName: input.firstName,
          lastName: input.lastName,
          phoneNumber: await this.freePhone(users, input.phoneNumber),
        }),
      );
    }

    const existing = await members.findOne({
      where: { companyId: input.companyId, userId: user.id },
      withDeleted: true,
    });

    if (existing && !existing.deletedAt) {
      throw new ConflictException({
        code: 'member_exists',
        memberId: existing.id,
        message: 'This account already belongs to the company',
      });
    }

    const fields = {
      role: input.role,
      status: 'active' as const,
      acceptsAutoAssign: input.acceptsAutoAssign ?? true,
      maxOpenConversations: input.maxOpenConversations ?? null,
      createdByMemberId: input.createdByMemberId ?? null,
    };

    if (existing) {
      await members.restore(existing.id);
      await members.update(existing.id, { ...fields, joinedAt: new Date() });
      const restored = await members.findOneByOrFail({ id: existing.id });

      return { member: restored, user, outcome: 'restored' };
    }

    const member = await members.save(
      members.create({ companyId: input.companyId, userId: user.id, ...fields }),
    );

    return {
      member,
      user,
      outcome: initialPassword ? 'created' : 'linked',
      initialPassword,
    };
  }

  /** An explicit username must be free; a derived one gets `-2`, `-3`... */
  private async freeUsername(
    users: Repository<User>,
    requested: string | undefined,
    email: string,
  ): Promise<string> {
    if (requested) {
      if (await users.exist({ where: { username: requested }, withDeleted: true })) {
        throw new ConflictException({
          code: 'username_taken',
          message: 'That username is already in use',
        });
      }
      return requested;
    }

    const base = this.slug(email.split('@')[0]);
    for (let n = 1; n <= MAX_USERNAME_SUFFIX; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      if (!(await users.exist({ where: { username: candidate }, withDeleted: true }))) {
        return candidate;
      }
    }

    throw new ConflictException({
      code: 'username_taken',
      message: 'Could not derive a free username; pick one',
    });
  }

  private async freePhone(
    users: Repository<User>,
    phoneNumber: string | undefined,
  ): Promise<string | undefined> {
    if (!phoneNumber) return undefined;

    if (await users.exist({ where: { phoneNumber }, withDeleted: true })) {
      throw new ConflictException({
        code: 'phone_taken',
        message: 'That phone number belongs to another account',
      });
    }
    return phoneNumber;
  }

  private slug(value: string): string {
    const slug = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);

    return slug.length >= 3 ? slug : `${slug || 'user'}-member`.slice(0, 60);
  }
}
