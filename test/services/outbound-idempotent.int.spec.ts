// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  CompanyFactory,
  CompanyMemberFactory,
  ConversationFactory,
  CustomerFactory,
} from '@factories';
import { ConversationSocketEvent } from '@contracts';
import type { ChannelAdapterRegistry } from '@modules/channels/ports/channel-adapter.registry';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { Conversation } from '@modules/conversations/entities/conversation.entity';
import { ConversationAssignment } from '@modules/conversations/entities/conversation-assignment.entity';
import { MessageSavedEvent } from '@modules/conversations/events/message-saved.event';
import { ConversationGateway } from '@modules/conversations/gateways/conversation.gateway';
import { AgentMessageSender } from '@modules/conversations/outbound/agent-message-sender.service';
import { ConversationFanoutService } from '@modules/conversations/realtime/conversation-fanout.service';
import { ConversationSendContextService } from '@modules/conversations/send-context/conversation-send-context.service';
import { CompanyMember } from '@modules/company-members/entities/company-member.entity';
import { MessageAttachment } from '@modules/message/entities/message-attachment.entity';
import { Message } from '@modules/message/entities/message.entity';
import { MessageRepository } from '@modules/message/message.repository';
import { MessageService } from '@modules/message/message.service';
import { AttachmentStorageService } from '@modules/media/attachment-storage.service';
import { MediaNormalizerChain } from '@modules/media/normalize/media-normalizer';
import { StagedUploadStore } from '@modules/media/staging/staged-upload.store';
import { OutgoingMediaService } from '@modules/conversations/outbound/outgoing-media.service';
import { ConversationUploadsService } from '@modules/conversations/uploads/conversation-uploads.service';
import { MessageAttachment as AttachmentRow } from '@modules/message/entities/message-attachment.entity';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from '../helpers/test-database.helper';

const entities = getSQLiteEntities();

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

/** Two-tier cache stand-in: the send context is cached per conversation. */
const memoryCache = () => {
  const store = new Map<string, unknown>();
  return {
    get: (key: string) => Promise.resolve(store.get(key)),
    set: (key: string, value: unknown) => Promise.resolve(store.set(key, value)),
    del: (key: string) => Promise.resolve(store.delete(key)),
  };
};

/**
 * T5 acceptance over a real (sqlite) database: an agent send is saved first
 * as `pending` (idempotent by `client_message_id`), the provider's id moves
 * the row to `sent`, and a failed send stays in the thread with its error.
 * The channel adapter is mocked; the socket contract is observed through the
 * real fanout.
 */
describe('Outbound idempotent agent send - integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let messageService: MessageService;
  let sender: AgentMessageSender;
  let uploads: ConversationUploadsService;
  let storageRoot: string;

  const adapter = { type: 'whatsapp', send: jest.fn(), uploadMedia: jest.fn() };
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot(getTestSQLiteConfig(entities))],
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

    storageRoot = mkdtempSync(join(tmpdir(), 'outbound-storage-'));
    const storage = new AttachmentStorageService(storageRoot);
    const cache = memoryCache() as never;
    const sendContext = new ConversationSendContextService(
      dataSource.getRepository(Conversation),
      cache,
    );
    const staged = new StagedUploadStore(storage, cache);
    uploads = new ConversationUploadsService(
      sendContext,
      staged,
      new MediaNormalizerChain([]),
    );

    sender = new AgentMessageSender(
      conversations,
      messageService,
      fanout,
      sendContext,
      { for: () => adapter } as unknown as ChannelAdapterRegistry,
      new OutgoingMediaService(staged, storage, messageService),
      eventBus as never,
      logger(),
    );
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    to.mockReturnValue({ emit });
    await clearSQLiteTables(dataSource);
  });

  afterAll(async () => {
    rmSync(storageRoot, { recursive: true, force: true });
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
      sender: { id: memberId, type: 'member' as const },
      clientMessageId,
      msg: { type: 'text' as const, text: 'hola' },
    };
  }

  it('saves the agent message as pending, then the provider id moves it to sent', async () => {
    const { company, member, conversation } = await setupConversation();
    const graph = deferred<unknown>();
    adapter.send.mockReturnValue(graph.promise);

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
    // The recipient is the conversation customer's address, resolved on the
    // server (WhatsApp falls back to the stored phone digits).
    expect(adapter.send).toHaveBeenCalledWith(
      conversation.channelId,
      '15551234567',
      { type: 'text', text: 'hola' },
    );

    graph.resolve({ ok: true, externalId: 'wamid-out-1' });
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
    adapter.send.mockResolvedValue({ ok: true, externalId: 'wamid-out-dup' });

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
    expect(adapter.send).toHaveBeenCalledTimes(1);

    const row = await dataSource
      .getRepository(Message)
      .findOneByOrFail({ id: first?.id });
    expect(row).toMatchObject({ status: 'sent', externalId: 'wamid-out-dup' });
  });

  it('keeps a failed send in the thread with its error code and message', async () => {
    const { company, member, conversation } = await setupConversation();
    adapter.send.mockResolvedValue({
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

  it('persists a visible failure when the upload does not exist', async () => {
    const { company, member, conversation } = await setupConversation();

    await sender.send({
      ...sendData(conversation.id, company.id, member.id, 'client-no-upload'),
      msg: {
        type: 'audio',
        uploadId: '0b9f6a3e-5c1d-4f7e-9a2b-3c4d5e6f7a8b',
        voice: true,
      },
    });

    const failed = await dataSource
      .getRepository(Message)
      .findOneByOrFail({ clientMessageId: 'client-no-upload' });
    expect(failed).toMatchObject({
      status: 'failed',
      errorMessage: 'Upload not found or expired',
    });
    expect(adapter.send).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.MessageStatus,
      expect.objectContaining({ id: failed.id, status: 'failed' }),
    );
  });

  it('sends a staged document end to end: upload, row, provider upload, send', async () => {
    const { company, member, conversation } = await setupConversation();
    const incoming = join(storageRoot, 'incoming.pdf');
    writeFileSync(incoming, '%PDF-1.7 cotizacion');
    adapter.uploadMedia.mockResolvedValue({ ok: true, providerMediaId: 'media-77' });
    adapter.send.mockResolvedValue({ ok: true, externalId: 'wamid-doc' });

    const stagedUpload = await uploads.stage(
      conversation.id,
      company.id,
      {
        path: incoming,
        size: 19,
        mimetype: 'application/pdf',
        originalname: 'Cotización final.pdf',
      },
      { kind: 'document' },
    );

    await sender.send({
      ...sendData(conversation.id, company.id, member.id, 'client-doc'),
      msg: {
        type: 'document',
        uploadId: stagedUpload.uploadId,
        filename: 'Cotización final.pdf',
        caption: 'Te paso la cotización',
      },
    });

    const row = await dataSource
      .getRepository(Message)
      .findOneByOrFail({ clientMessageId: 'client-doc' });
    expect(row).toMatchObject({
      status: 'sent',
      externalId: 'wamid-doc',
      body: 'Te paso la cotización',
    });

    const [attachment] = await dataSource
      .getRepository(AttachmentRow)
      .findBy({ messageId: row.id });
    expect(attachment).toMatchObject({
      type: 'document',
      status: 'ready',
      mimeType: 'application/pdf',
      sizeBytes: 19,
      fileName: 'Cotización final.pdf',
      // Remembered: a retry never uploads the file twice.
      externalMediaId: 'media-77',
      storageUrl: `/uploads/${company.id}/${stagedUpload.uploadId}.pdf`,
    });
    // The file left staging for the company storage, and Graph got that path.
    expect(
      existsSync(join(storageRoot, company.id, `${stagedUpload.uploadId}.pdf`)),
    ).toBe(true);
    expect(adapter.uploadMedia).toHaveBeenCalledWith(conversation.channelId, {
      absolutePath: join(storageRoot, company.id, `${stagedUpload.uploadId}.pdf`),
      mimeType: 'application/pdf',
      filename: 'Cotización final.pdf',
      sizeBytes: 19,
    });
    expect(adapter.send).toHaveBeenCalledWith(conversation.channelId, '15551234567', {
      type: 'document',
      media: { providerMediaId: 'media-77', mimeType: 'application/pdf' },
      filename: 'Cotización final.pdf',
      caption: 'Te paso la cotización',
    });

    // History renders it through the private attachments endpoint.
    const [view] = await messageService.getConversationMessages(conversation.id);
    expect(view.msg).toMatchObject({
      type: 'document',
      filename: 'Cotización final.pdf',
      caption: 'Te paso la cotización',
      media: { url: `/attachments/${attachment.id}`, status: 'ready' },
    });
  });
});
