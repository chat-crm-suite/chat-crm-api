// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { DataSource } from 'typeorm';

import type { MemberRole } from '@contracts';
import { Channel } from '@modules/channels/entities/channel.entity';
import { CompanyMember } from '@modules/company-members/entities/company-member.entity';
import { Company } from '@modules/company/entities/company.entity';
import { ConversationAssignment } from '@modules/conversations/entities/conversation-assignment.entity';
import { Conversation } from '@modules/conversations/entities/conversation.entity';
import { Customer } from '@modules/customers/entities/customer.entity';
import { User } from '@modules/users/entities/user.entity';

/**
 * Minimal inbox rows for SQLite service specs (companies, members,
 * conversations with an optional owner). `create` first: the UUID v7 id
 * comes from an entity hook.
 */
export function inboxSeed(dataSource: DataSource) {
  let seq = 0;

  const save = <T extends object>(entity: new () => T, data: Partial<T>) => {
    const repo = dataSource.getRepository(entity);
    return repo.save(repo.create(data as T));
  };

  const company = () => save(Company, { name: `company-${++seq}` });

  const member = async (owner: Company, role: MemberRole = 'agent', firstName?: string) => {
    const user = await save(User, {
      username: `user-${++seq}`,
      passwordHash: 'x',
      firstName: firstName ?? null,
    } as Partial<User>);
    return save(CompanyMember, {
      userId: user.id,
      companyId: owner.id,
      role,
      status: 'active',
    });
  };

  const channel = (owner: Company, type: Channel['type'] = 'whatsapp') =>
    save(Channel, {
      companyId: owner.id,
      type,
      name: `channel-${++seq}`,
      externalAccountId: `account-${seq}`,
      credentials: 'encrypted',
      status: 'active',
    });

  const conversation = async (
    owner: Company,
    options: { assignee?: CompanyMember; lastInboundAt?: Date; channel?: Channel } = {},
  ) => {
    const ch = options.channel ?? (await channel(owner));
    const customer = await save(Customer, {
      companyId: owner.id,
      displayName: `Customer ${++seq}`,
      phoneNumber: `+5199900${String(seq).padStart(4, '0')}`,
    });
    const row = await save(Conversation, {
      companyId: owner.id,
      customerId: customer.id,
      channelId: ch.id,
      status: 'open',
      priority: 'low',
      lastInboundAt: options.lastInboundAt ?? new Date(),
      assignedMemberId: options.assignee?.id ?? null,
    });
    if (options.assignee) {
      await save(ConversationAssignment, {
        conversationId: row.id,
        memberId: options.assignee.id,
        reason: 'manual',
        assignedAt: new Date(Date.now() - 60_000),
      });
    }
    return { conversation: row, customer, channel: ch };
  };

  return { save, company, member, channel, conversation };
}
