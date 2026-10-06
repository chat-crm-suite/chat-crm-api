// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, EntityTarget } from 'typeorm';

import * as Entities from '@entities';
import {
  CompanyFactory,
  CompanyMemberFactory,
  ConversationFactory,
  CustomerFactory,
} from '@factories';
import { AgentMessageSender } from '@integrations/whatsapp/outbound/agent-message-sender.service';
import type { WhatsAppService } from '@integrations/whatsapp/whatsapp.service';
import { ConversationSocketEvent } from '../../src/contracts/index';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { Conversation } from '@modules/conversations/entities/conversation.entity';
import { ConversationAssignment } from '@modules/conversations/entities/conversation-assignment.entity';
import { MessageSavedEvent } from '@modules/conversations/events/message-saved.event';
import { ConversationGateway } from '@modules/conversations/gateways/conversation.gateway';
import { ConversationFanoutService } from '@modules/conversations/realtime/conversation-fanout.service';
import { CompanyMember } from '@modules/company-members/entities/company-member.entity';
import { MessageAttachment } from '@modules/message/entities/message-attachment.entity';
import { Message } from '@modules/message/entities/message.entity';
import { MessageRepository } from '@modules/message/message.repository';
import { MessageService } from '@modules/message/message.service';
import {
  getTestConfig,
  truncateAllTables,
} from '../helpers/test-database.helper';

const entities = Object.values(Entities) as EntityTarget<unknown>[];

jest.setTimeout(120_000);

const logger = () =>
  ({
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  }) as never;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function waitFor<T>(
  read: () => Promise<T | null | undefined>,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error('waitFor timed out');
}

/**
 * T5 acceptance over the real DB: an agent send is saved first as `pending`
 * (idempotent by `client_message_id`), Graph's wamid moves the row to `sent`,
 * and a failed send stays in the thread with its error. The Graph boundary is
 * mocked; the socket contract is observed through the real fanout.
 */
describe('Outbound idempotent agent send - integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let messageService: MessageService;
  let sender: AgentMessageSender;

  const deliverMessage = jest.fn();
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot(getTestConfig(entities))],
    }).compile();

    dataSource = module.get<DataSource>(getDataSourceToken());

    const messageRepository = new MessageRepository(
      dataSource.getRepository(Message),
      dataSource.getRepository(MessageAttachment),
      dataSource,
    );
    messageService = new MessageService(messageRepository);

    const conversations = new ConversationsService(
      dataSource.getRepository(Conversation),
      dataSource.getRepository(ConversationAssignment),
      dataSource.getRepository(CompanyMember),
      {} as never,
      {} as never,
      {} as never,
      messageService,
      logger(),
    );

    const gateway = { server: { to } } as unknown as ConversationGateway;
    const fanout = new ConversationFanoutService(
      gateway,
      { getActiveAssignee: jest.fn().mockResolvedValue(null) } as never,
      logger(),
    );

    // Mirrors the existing saga mapping (MessageSavedEvent -> broadcast of the
    // saved payload); the mapping itself is covered by conversation.saga.spec.
    const eventBus = {
      publish: async (event: unknown) => {
        if (!(event instanceof MessageSavedEvent)) return;
        const payload = await messageService.getMessagePayload(
          event.message.id,
        );
        if (payload) {
          await fanout.emitMessage(event.message.conversationId, payload);
        }
      },
    };

    sender = new AgentMessageSender(
      conversations,
      messageService,
      { deliverMessage } as unknown as WhatsAppService,
      fanout,
      eventBus as never,
      logger(),
    );
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    to.mockReturnValue({ emit });
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
    if (module) await module.close();
  });

  async function setupConversation() {
    const manager = dataSource.manager;
    const company = await CompanyFactory.transient({ manager }).create();
    const customer = await CustomerFactory.transient({ manager }).create({
      companyId: company.id,
      phoneNumber: '+15551234567',
    });
    const member = await CompanyMemberFactory.transient({ manager }).create({
      companyId: company.id,
    });
    const conversation = await ConversationFactory.transient({
      manager,
    }).create({
      companyId: company.id,
      customerId: customer.id,
    });

    return { company, customer, member, conversation };
  }

  function sendData(
    conversationId: string,
    companyId: string,
    memberId: string,
    clientMessageId: string,
  ) {
    return {
      room: conversationId,
      companyId,
      to: '+15551234567',
      sender: { id: memberId, type: 'member' as const },
      clientMessageId,
      msg: { type: 'text' as const, content: { body: 'hola' } },
    };
  }

  it('saves the agent message as pending, then Graph wamid moves it to sent', async () => {
    const { company, member, conversation } = await setupConversation();
    const graph = deferred<unknown>();
    deliverMessage.mockReturnValue(graph.promise);

    const sending = sender.send(
      sendData(conversation.id, company.id, member.id, 'client-1'),
    );

    // Wait for the persisted row AND its live broadcast: both happen before
    // Graph answers.
    const pending = await waitFor(async () => {
      const row = await dataSource.getRepository(Message).findOne({
        where: { conversationId: conversation.id, clientMessageId: 'client-1' },
      });
      if (!row) return null;

      const broadcasted = emit.mock.calls.some(
        ([event, payload]) =>
          event === ConversationSocketEvent.BroadcastMessage &&
          (payload as { id?: string })?.id === row.id,
      );

      return broadcasted ? row : null;
    });

    // The row exists and is visible before Graph answers; the live broadcast
    // carries it as pending, and no `sent` confirmation was emitted.
    expect(pending).toMatchObject({
      status: 'pending',
      direction: 'outbound',
      senderType: 'member',
      body: 'hola',
      externalId: null,
    });
    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.BroadcastMessage,
      expect.objectContaining({ id: pending.id, status: 'pending' }),
    );
    expect(emit).not.toHaveBeenCalledWith(
      ConversationSocketEvent.MessageStatus,
      expect.anything(),
    );
    const [sentPayload, sentCompanyId] = deliverMessage.mock.calls[0] as [
      { type?: string; to?: string; text?: { body?: string } },
      string,
    ];
    expect(sentPayload).toMatchObject({
      type: 'text',
      to: '+15551234567',
    });
    expect(sentPayload.text?.body).toBe('hola');
    expect(sentCompanyId).toBe(company.id);

    graph.resolve({
      ok: true,
      response: { messages: [{ id: 'wamid-out-1' }] },
    });
    await sending;

    const sent = await dataSource
      .getRepository(Message)
      .findOneByOrFail({ id: pending.id });
    expect(sent).toMatchObject({ status: 'sent', externalId: 'wamid-out-1' });
    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.MessageStatus,
      expect.objectContaining({
        id: pending.id,
        conversationId: conversation.id,
        clientMessageId: 'client-1',
        status: 'sent',
      }),
    );
  });

  it('double submit with the same client id creates one row and sends once', async () => {
    const { company, member, conversation } = await setupConversation();
    deliverMessage.mockResolvedValue({
      ok: true,
      response: { messages: [{ id: 'wamid-out-dup' }] },
    });

    const first = await sender.send(
      sendData(conversation.id, company.id, member.id, 'client-dup'),
    );
    const second = await sender.send(
      sendData(conversation.id, company.id, member.id, 'client-dup'),
    );

    expect(
      await dataSource
        .getRepository(Message)
        .countBy({ conversationId: conversation.id }),
    ).toBe(1);
    expect(second?.id).toBe(first?.id);
    expect(deliverMessage).toHaveBeenCalledTimes(1);

    const row = await dataSource
      .getRepository(Message)
      .findOneByOrFail({ id: first?.id });
    expect(row).toMatchObject({ status: 'sent', externalId: 'wamid-out-dup' });
  });

  it('concurrent double submit still creates one row and sends once', async () => {
    const { company, member, conversation } = await setupConversation();
    deliverMessage.mockResolvedValue({
      ok: true,
      response: { messages: [{ id: 'wamid-out-race' }] },
    });

    const [first, second] = await Promise.all([
      sender.send(
        sendData(conversation.id, company.id, member.id, 'client-race'),
      ),
      sender.send(
        sendData(conversation.id, company.id, member.id, 'client-race'),
      ),
    ]);

    expect(
      await dataSource
        .getRepository(Message)
        .countBy({ conversationId: conversation.id }),
    ).toBe(1);
    expect(second?.id).toBe(first?.id);
    expect(deliverMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed send in the thread with its error code and message', async () => {
    const { company, member, conversation } = await setupConversation();
    deliverMessage.mockResolvedValue({
      ok: false,
      error: {
        authFault: true,
        retryable: false,
        code: '190',
        message: 'expired token',
      },
    });

    await sender.send(
      sendData(conversation.id, company.id, member.id, 'client-fail'),
    );

    const failed = await dataSource
      .getRepository(Message)
      .findOneByOrFail({ clientMessageId: 'client-fail' });
    expect(failed).toMatchObject({
      status: 'failed',
      errorCode: '190',
      errorMessage: 'expired token',
      externalId: null,
    });

    // Still part of the conversation history after a reload.
    const thread = await messageService.getConversationMessages(
      conversation.id,
    );
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({ id: failed.id, status: 'failed' });

    // Live: the status patch carries the failure and the legacy error event
    // still fires for the open thread.
    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.MessageStatus,
      expect.objectContaining({
        id: failed.id,
        status: 'failed',
        errorCode: '190',
        errorMessage: 'expired token',
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.ErrorMessage,
      expect.objectContaining({ code: 190, message: 'expired token' }),
    );
  });

  it('treats a Graph answer without a wamid as a failed send', async () => {
    const { company, member, conversation } = await setupConversation();
    deliverMessage.mockResolvedValue({ ok: true, response: {} });

    await sender.send(
      sendData(conversation.id, company.id, member.id, 'client-no-wamid'),
    );

    const failed = await dataSource
      .getRepository(Message)
      .findOneByOrFail({ clientMessageId: 'client-no-wamid' });
    expect(failed.status).toBe('failed');
    expect(failed.errorMessage).toBeTruthy();
  });

  it('persists a visible failure when the message type cannot be sent', async () => {
    const { company, member, conversation } = await setupConversation();

    await sender.send({
      ...sendData(conversation.id, company.id, member.id, 'client-bad-type'),
      msg: { type: 'audio', content: { body: 'nota de voz' } },
    });

    const failed = await dataSource
      .getRepository(Message)
      .findOneByOrFail({ clientMessageId: 'client-bad-type' });
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed.errorMessage).toContain('audio');
    expect(deliverMessage).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.MessageStatus,
      expect.objectContaining({ id: failed.id, status: 'failed' }),
    );
  });
});
