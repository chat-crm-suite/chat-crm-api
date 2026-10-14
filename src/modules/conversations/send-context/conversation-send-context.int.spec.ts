// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, EntityTarget } from 'typeorm';

import * as Entities from '@entities';
import { ConversationFactory } from '@factories';
import { getTestSQLiteConfig } from '@helpers/test-database.helper';
import { CustomerIdentity } from '../../customers/entities/customer-identity.entity';
import { Conversation } from '../entities/conversation.entity';
import {
  ConversationSendContextService,
  SEND_CONTEXT_TTL_MS,
  sendContextKey,
} from './conversation-send-context.service';

// Same sqlite exclusion as the shared test config (bigint PK).
const entities = Object.values(Entities).filter(
  (entity) => entity.name !== 'MessageStatusEvent',
) as EntityTarget<unknown>[];

/** In-memory stand-in for the two-tier cache. */
function memoryCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn((key: string) => Promise.resolve(store.get(key))),
    set: jest.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve(value);
    }),
    del: jest.fn((key: string) => Promise.resolve(store.delete(key))),
  };
}

/**
 * The outbound destination is resolved on the server from the conversation:
 * the customer's identity on the conversation's channel. Whatever the client
 * sends as `to` never reaches the provider.
 */
describe('ConversationSendContextService', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: ConversationSendContextService;
  const cache = memoryCache();

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(getTestSQLiteConfig(entities)),
        TypeOrmModule.forFeature([Conversation]),
      ],
      providers: [
        ConversationSendContextService,
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();

    service = module.get(ConversationSendContextService);
    dataSource = module.get<DataSource>(getDataSourceToken());
  }, 60_000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
    if (module) await module.close();
  });

  beforeEach(() => {
    cache.store.clear();
    jest.clearAllMocks();
  });

  const createConversation = () =>
    ConversationFactory.transient({ manager: dataSource.manager }).create();

  const addIdentity = (conversation: Conversation, externalId: string) =>
    dataSource.getRepository(CustomerIdentity).save(
      dataSource.getRepository(CustomerIdentity).create({
        customerId: conversation.customerId,
        channelId: conversation.channelId,
        externalId,
      }),
    );

  it("resolves the recipient from the customer's identity on the channel", async () => {
    const conversation = await createConversation();
    await addIdentity(conversation, '51999000111');

    await expect(service.get(conversation.id)).resolves.toEqual({
      conversationId: conversation.id,
      companyId: conversation.companyId,
      channelId: conversation.channelId,
      channelType: 'whatsapp',
      recipient: '51999000111',
    });
  });

  it('falls back to the stored phone digits on WhatsApp', async () => {
    const conversation = await createConversation();
    const context = await service.get(conversation.id);

    expect(context?.recipient).toMatch(/^519\d{8}$/);
  });

  it('caches the context and serves it without querying again', async () => {
    const conversation = await createConversation();
    await addIdentity(conversation, '51999000222');
    const query = jest.spyOn(
      dataSource.getRepository(Conversation),
      'createQueryBuilder',
    );

    const first = await service.get(conversation.id);
    expect(query).toHaveBeenCalledTimes(1);
    const second = await service.get(conversation.id);

    expect(second).toEqual(first);
    expect(query).toHaveBeenCalledTimes(1);
    query.mockRestore();
    expect(cache.set).toHaveBeenCalledWith(
      sendContextKey(conversation.id),
      first,
      SEND_CONTEXT_TTL_MS,
    );
  });

  it('reloads after invalidation', async () => {
    const conversation = await createConversation();
    await service.get(conversation.id);

    await service.invalidate(conversation.id);

    expect(cache.store.has(sendContextKey(conversation.id))).toBe(false);
  });

  it('returns null for unknown or deleted conversations', async () => {
    await expect(service.get('missing')).resolves.toBeNull();

    const conversation = await createConversation();
    await dataSource.getRepository(Conversation).softDelete(conversation.id);

    await expect(service.get(conversation.id)).resolves.toBeNull();
  });
});
