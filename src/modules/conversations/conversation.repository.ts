// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';

import { normalizePhoneNumber } from '../../lib/helpers/phone.helper';
import { CustomersService } from '../customers/customers.service';
import { Customer } from '../customers/entities/customer.entity';
import { ConversationAssignment } from './entities/conversation-assignment.entity';
import { Conversation } from './entities/conversation.entity';

@Injectable()
export class ConversationRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly customers: CustomersService,
  ) {}

  /**
   * Webhook entry: resolves the customer through `customer_identities`
   * (CustomersService.findOrCreateIncoming) and returns its conversation for
   * that channel, creating it on first contact.
   */
  async findOrCreateIncoming(params: {
    companyId: string;
    channelId: string;
    externalId: string;
    phoneNumber?: string;
    profileName?: string;
  }): Promise<{ conversation: Conversation; customer: Customer }> {
    const customer = await this.customers.findOrCreateIncoming(params);
    const repo = this.dataSource.getRepository(Conversation);

    let conversation = await repo.findOne({
      where: {
        companyId: params.companyId,
        customerId: customer.id,
        channelId: params.channelId,
        deletedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });

    if (!conversation) {
      conversation = await repo.save(
        repo.create({
          companyId: params.companyId,
          customerId: customer.id,
          channelId: params.channelId,
          status: 'open',
          priority: 'low',
        }),
      );
    }

    return { conversation, customer };
  }

  /** Conversations of a member (active assignment), with last message + customer. */
  async listForMember(memberId: string) {
    const conversations = await this.dataSource
      .getRepository(Conversation)
      .createQueryBuilder('conversation')
      .innerJoinAndSelect('conversation.customer', 'customer')
      .innerJoin(
        ConversationAssignment,
        'ca',
        'ca.conversation_id = conversation.id AND ca.unassigned_at IS NULL',
      )
      .leftJoinAndSelect('conversation.lastMessage', 'lastMessage')
      .where('ca.member_id = :memberId', { memberId })
      .andWhere('conversation.status NOT IN (:...excluded)', {
        excluded: ['closed', 'archived'],
      })
      .andWhere('conversation.deleted_at IS NULL')
      .orderBy('conversation.lastMessageAt', 'DESC')
      .getMany();

    return conversations.map((conversation) => ({
      id: conversation.id,
      preview: {
        content: conversation.lastMessage?.body ?? null,
        datetime: conversation.lastMessageAt ?? null,
        type: conversation.lastMessage?.type ?? null,
      },
      customer: {
        id: conversation.customer?.id,
        displayName: conversation.customer?.displayName,
        phone: conversation.customer?.phoneNumber,
      },
      status: conversation.status,
      createdAt: conversation.createdAt,
    }));
  }

  /** Latest conversation of the customer that owns a phone (webhook failures). */
  async findConversationByCustomerPhone(
    phoneNumber: string,
  ): Promise<Conversation | null> {
    const customer = await this.dataSource.getRepository(Customer).findOne({
      where: { phoneNumber: normalizePhoneNumber(phoneNumber) },
      select: { id: true },
    });
    if (!customer) return null;

    return this.dataSource.getRepository(Conversation).findOne({
      where: { customerId: customer.id, deletedAt: IsNull() },
      order: { lastMessageAt: 'DESC' },
    });
  }
}
