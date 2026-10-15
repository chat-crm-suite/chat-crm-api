// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { ChannelType } from '@contracts';
import { CustomerIdentity } from '../../customers/entities/customer-identity.entity';
import { Conversation } from '../entities/conversation.entity';

/** Short-lived: the destination of a conversation almost never changes. */
export const SEND_CONTEXT_TTL_MS = 5 * 60 * 1000;

export const sendContextKey = (conversationId: string) =>
  `conv:send-ctx:${conversationId}`;

/**
 * Where an outbound message of one conversation goes, resolved on the server
 * only: the client never names the recipient. `recipient` is the customer's
 * address on the conversation's channel (`wa_id` for WhatsApp, `chat_id` for
 * Telegram…), or `null` when the customer has none there.
 */
export interface ConversationSendContext {
  conversationId: string;
  companyId: string;
  channelId: string;
  channelType: ChannelType;
  recipient: string | null;
}

interface SendContextRow {
  companyId: string;
  channelId: string;
  channelType: ChannelType;
  externalId: string | null;
  phoneNumber: string | null;
}

/**
 * One query (conversation + channel + the customer's identity on that
 * channel), cached in the two-tier cache (memory LRU + Redis) so the send hot
 * path does not touch MySQL.
 */
@Injectable()
export class ConversationSendContextService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async get(conversationId: string): Promise<ConversationSendContext | null> {
    const key = sendContextKey(conversationId);
    const cached = await this.cache.get<ConversationSendContext>(key);
    if (cached) return cached;

    const context = await this.load(conversationId);
    if (context) await this.cache.set(key, context, SEND_CONTEXT_TTL_MS);

    return context;
  }

  /** Drop the cached destination (channel or customer of the conversation changed). */
  async invalidate(conversationId: string): Promise<void> {
    await this.cache.del(sendContextKey(conversationId));
  }

  private async load(
    conversationId: string,
  ): Promise<ConversationSendContext | null> {
    const row = await this.conversations
      .createQueryBuilder('conversation')
      .innerJoin('conversation.channel', 'channel')
      // Replying keeps working when the customer was soft-deleted (the query
      // still filters `conversation.deleted_at`).
      .withDeleted()
      .innerJoin('conversation.customer', 'customer')
      .leftJoin(
        CustomerIdentity,
        'identity',
        'identity.customer_id = conversation.customer_id AND identity.channel_id = conversation.channel_id',
      )
      .select('conversation.company_id', 'companyId')
      .addSelect('conversation.channel_id', 'channelId')
      .addSelect('channel.type', 'channelType')
      .addSelect('identity.external_id', 'externalId')
      .addSelect('customer.phone_number', 'phoneNumber')
      .where('conversation.id = :conversationId', { conversationId })
      .andWhere('conversation.deleted_at IS NULL')
      // A customer that changed number keeps both identities: newest wins.
      .orderBy('identity.created_at', 'DESC')
      .getRawOne<SendContextRow>();

    if (!row) return null;

    return {
      conversationId,
      companyId: row.companyId,
      channelId: row.channelId,
      channelType: row.channelType,
      recipient:
        row.externalId ??
        (row.channelType === 'whatsapp' ? phoneDigits(row.phoneNumber) : null),
    };
  }
}

/**
 * WhatsApp fallback for customers created before identities existed: the
 * stored `+digits` phone is the `wa_id` without the plus.
 */
function phoneDigits(phoneNumber: string | null): string | null {
  const digits = phoneNumber?.replace(/\D/g, '');
  return digits || null;
}
