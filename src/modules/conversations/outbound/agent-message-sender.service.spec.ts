// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { Message } from '@modules/message/entities/message.entity';
import type { AgentSendJob } from '../commands/send-conversation-message.command';
import { MessageSavedEvent } from '../events/message-saved.event';
import { AgentMessageSender } from './agent-message-sender.service';

/**
 * T5 outbound pipeline: the row is saved pending first and the provider is called
 * exactly once per client send. A stalled BullMQ retry is the exception: the
 * original attempt died, so the still-`pending` row is sent again instead of
 * staying pending forever. A fresh duplicate never triggers a second call.
 */
const data: AgentSendJob = {
  room: 'conv-1',
  companyId: 'co-1',
  sender: { id: 'member-1', type: 'member' },
  clientMessageId: 'client-1',
  msg: { type: 'text', text: 'hola' },
};

const message = (overrides: Partial<Message> = {}): Message =>
  ({
    id: 'msg-1',
    conversationId: 'conv-1',
    clientMessageId: 'client-1',
    status: 'pending',
    ...overrides,
  }) as Message;

function build() {
  const conversations = { saveOutbound: jest.fn() };
  const messages = {
    markSent: jest.fn(),
    markSendFailed: jest.fn(),
    resetFailedForRetry: jest.fn(),
  };
  const adapter = { type: 'whatsapp', send: jest.fn(), uploadMedia: jest.fn() };
  const adapters = { for: jest.fn().mockReturnValue(adapter) };
  const media = {
    prepare: jest.fn().mockResolvedValue(null),
    attachmentOf: jest.fn(),
    toProvider: jest.fn(),
  };
  const fanout = { emitStatusPatch: jest.fn(), emitError: jest.fn() };
  const sendContext = {
    get: jest.fn().mockResolvedValue({
      conversationId: 'conv-1',
      companyId: 'co-1',
      channelId: 'channel-1',
      channelType: 'whatsapp',
      recipient: '51999000111',
    }),
  };
  const eventBus = { publish: jest.fn() };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };

  const sender = new AgentMessageSender(
    conversations as never,
    messages as never,
    fanout as never,
    sendContext as never,
    adapters as never,
    media as never,
    eventBus as never,
    logger as never,
  );

  return {
    sender,
    conversations,
    messages,
    adapter,
    adapters,
    media,
    fanout,
    sendContext,
    eventBus,
    logger,
  };
}

describe('AgentMessageSender stalled retries (T5)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends and broadcasts a freshly created row', async () => {
    const { sender, conversations, messages, adapter, fanout, eventBus } =
      build();
    const pending = message();
    conversations.saveOutbound.mockResolvedValue({
      message: pending,
      created: true,
    });
    adapter.send.mockResolvedValue({ ok: true, externalId: 'wamid-1' });
    messages.markSent.mockResolvedValue(
      message({ status: 'sent', externalId: 'wamid-1' }),
    );

    await sender.send(data, { attemptsMade: 0 });

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.any(MessageSavedEvent),
    );
    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(messages.markSent).toHaveBeenCalledWith('msg-1', 'wamid-1');
    expect(fanout.emitStatusPatch).toHaveBeenCalled();
  });

  it('ignores a fresh duplicate without calling the provider again', async () => {
    const { sender, conversations, adapter, eventBus } = build();
    const existing = message();
    conversations.saveOutbound.mockResolvedValue({
      message: existing,
      created: false,
    });

    await expect(sender.send(data, { attemptsMade: 0 })).resolves.toBe(
      existing,
    );

    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('sends the still-pending row when a stalled job retries', async () => {
    const { sender, conversations, messages, adapter, eventBus } = build();
    const pending = message();
    conversations.saveOutbound.mockResolvedValue({
      message: pending,
      created: false,
    });
    adapter.send.mockResolvedValue({ ok: true, externalId: 'wamid-1' });
    messages.markSent.mockResolvedValue(
      message({ status: 'sent', externalId: 'wamid-1' }),
    );

    await sender.send(data, { attemptsMade: 1 });

    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(messages.markSent).toHaveBeenCalledWith('msg-1', 'wamid-1');
    // The first attempt already broadcast the pending row.
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('ignores a retry when the row already moved past pending', async () => {
    const { sender, conversations, messages, adapter } = build();
    const sent = message({ status: 'sent', externalId: 'wamid-1' });
    conversations.saveOutbound.mockResolvedValue({
      message: sent,
      created: false,
    });

    await expect(sender.send(data, { attemptsMade: 2 })).resolves.toBe(sent);

    expect(adapter.send).not.toHaveBeenCalled();
    expect(messages.markSent).not.toHaveBeenCalled();
  });
});

describe('AgentMessageSender failed retries (#8)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('re-attempts delivery when the user retries a failed row', async () => {
    const { sender, conversations, messages, adapter, fanout, eventBus } =
      build();
    const failed = message({
      status: 'failed',
      errorCode: '131047',
      errorMessage: 'Re-engagement message',
    });
    const pending = message({
      status: 'pending',
      errorCode: null,
      errorMessage: null,
    });
    conversations.saveOutbound.mockResolvedValue({
      message: failed,
      created: false,
    });
    messages.resetFailedForRetry.mockResolvedValue(pending);
    adapter.send.mockResolvedValue({ ok: true, externalId: 'wamid-2' });
    messages.markSent.mockResolvedValue(
      message({ status: 'sent', externalId: 'wamid-2' }),
    );

    await sender.send(data, { attemptsMade: 0 });

    expect(messages.resetFailedForRetry).toHaveBeenCalledWith('msg-1');
    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(messages.markSent).toHaveBeenCalledWith('msg-1', 'wamid-2');
    // The reset broadcasts the row going back to pending, then the provider's answer
    // moves it to sent.
    expect(fanout.emitStatusPatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'msg-1', status: 'pending' }),
    );
    expect(fanout.emitStatusPatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'msg-1', status: 'sent' }),
    );
    // The first send already broadcast the row; a retry only patches it.
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('keeps the row failed when the retry fails again', async () => {
    const { sender, conversations, messages, adapter, fanout } = build();
    conversations.saveOutbound.mockResolvedValue({
      message: message({ status: 'failed' }),
      created: false,
    });
    messages.resetFailedForRetry.mockResolvedValue(
      message({ status: 'pending' }),
    );
    adapter.send.mockResolvedValue({
      ok: false,
      error: {
        authFault: false,
        retryable: false,
        code: '131047',
        message: 'Re-engagement message',
      },
    });
    messages.markSendFailed.mockResolvedValue(
      message({ status: 'failed', errorCode: '131047' }),
    );

    await sender.send(data, { attemptsMade: 0 });

    expect(messages.markSendFailed).toHaveBeenCalledWith('msg-1', {
      code: '131047',
      message: 'Re-engagement message',
    });
    expect(fanout.emitError).toHaveBeenCalled();
  });

  it('lets only one of two concurrent retries reach the provider', async () => {
    const { sender, conversations, messages, adapter } = build();
    conversations.saveOutbound.mockResolvedValue({
      message: message({ status: 'failed' }),
      created: false,
    });
    // The repository CAS: the first caller flips failed -> pending, the second
    // finds the row already moved and loses.
    let won = false;
    messages.resetFailedForRetry.mockImplementation(() => {
      if (won) return Promise.resolve(null);
      won = true;
      return Promise.resolve(message({ status: 'pending' }));
    });
    adapter.send.mockResolvedValue({ ok: true, externalId: 'wamid-2' });
    messages.markSent.mockResolvedValue(
      message({ status: 'sent', externalId: 'wamid-2' }),
    );

    await Promise.all([sender.send(data), sender.send(data)]);

    expect(messages.resetFailedForRetry).toHaveBeenCalledTimes(2);
    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(messages.markSent).toHaveBeenCalledTimes(1);
  });

  it('flags a closed reply window with the template action and recipient (#9)', async () => {
    const { sender, conversations, messages, adapter, fanout } = build();
    conversations.saveOutbound.mockResolvedValue({
      message: message(),
      created: true,
    });
    adapter.send.mockResolvedValue({
      ok: false,
      error: {
        authFault: false,
        retryable: false,
        code: '131047',
        message: 'Re-engagement message',
        replyWindowClosed: true,
      },
    });
    messages.markSendFailed.mockResolvedValue(
      message({ status: 'failed', errorCode: '131047' }),
    );

    await sender.send(data, { attemptsMade: 0 });

    expect(fanout.emitError).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        code: 131047,
        hasAction: true,
        // The server-resolved recipient, never the client-supplied `to`.
        to: '51999000111',
      }),
    );
  });

  it('leaves the legacy error shape unchanged for other failures (#9)', async () => {
    const { sender, conversations, messages, adapter, fanout } = build();
    conversations.saveOutbound.mockResolvedValue({
      message: message(),
      created: true,
    });
    adapter.send.mockResolvedValue({
      ok: false,
      error: {
        authFault: true,
        retryable: false,
        code: '190',
        message: 'expired token',
      },
    });
    messages.markSendFailed.mockResolvedValue(
      message({ status: 'failed', errorCode: '190' }),
    );

    await sender.send(data, { attemptsMade: 0 });

    // Exact shape: a plain failure carries no hasAction/to.
    expect(fanout.emitError).toHaveBeenCalledWith('conv-1', {
      code: 190,
      title: 'Whatsapp cliente error',
      message: 'expired token',
      error_data: {
        details: 'Request whatsapp client error for text message',
      },
    });
  });
});

/**
 * The destination is resolved on the server from the conversation: a client
 * that names another phone in `to` can never redirect the send.
 */
describe('AgentMessageSender channel routing', () => {
  beforeEach(() => jest.clearAllMocks());

  const created = (conversations: { saveOutbound: jest.Mock }) =>
    conversations.saveOutbound.mockResolvedValue({
      message: message(),
      created: true,
    });

  it("sends through the conversation channel's adapter to the server-resolved recipient", async () => {
    const { sender, conversations, adapter, adapters, messages, sendContext } =
      build();
    created(conversations);
    adapter.send.mockResolvedValue({ ok: true, externalId: 'wamid-1' });
    messages.markSent.mockResolvedValue(message({ status: 'sent' }));

    // Extra client fields (a forged `to`) never reach the provider.
    await sender.send(
      { ...data, to: '+19990000000' } as unknown as AgentSendJob,
      { attemptsMade: 0 },
    );

    expect(sendContext.get).toHaveBeenCalledWith('conv-1');
    expect(adapters.for).toHaveBeenCalledWith('whatsapp');
    expect(adapter.send).toHaveBeenCalledWith('channel-1', '51999000111', {
      type: 'text',
      text: 'hola',
    });  });

  it('logs one send.timing line correlated by clientMessageId', async () => {
    const { sender, conversations, adapter, messages, logger } = build();
    created(conversations);
    adapter.send.mockResolvedValue({ ok: true, externalId: 'wamid-1' });
    messages.markSent.mockResolvedValue(message({ status: 'sent' }));

    await sender.send({ ...data, receivedAt: Date.now() - 5 });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMessageId: 'client-1',
        messageId: 'msg-1',
        type: 'text',
        status: 'sent',
        queueMs: expect.any(Number) as number,
        totalMs: expect.any(Number) as number,
      }),
      'send.timing',
    );
  });

  it('persists the text as the message body', async () => {
    const { sender, conversations, adapter, messages } = build();
    created(conversations);
    adapter.send.mockResolvedValue({ ok: true, externalId: 'wamid-1' });
    messages.markSent.mockResolvedValue(message({ status: 'sent' }));

    await sender.send(data);

    expect(conversations.saveOutbound).toHaveBeenCalledWith(
      'conv-1',
      { type: 'text', content: { body: 'hola' }, clientMessageId: 'client-1' },
      { id: 'member-1', type: 'member' },
      'co-1',
    );
  });

  it('fails the row when no adapter is installed for the channel', async () => {
    const { sender, conversations, adapter, adapters, messages } = build();
    created(conversations);
    adapters.for.mockReturnValue(null);
    messages.markSendFailed.mockResolvedValue(message({ status: 'failed' }));

    await sender.send(data);

    expect(adapter.send).not.toHaveBeenCalled();
    expect(messages.markSendFailed).toHaveBeenCalledWith('msg-1', {
      code: null,
      message: 'No whatsapp adapter is installed',
    });
  });

  it('fails the row without calling the provider when there is no recipient', async () => {
    const { sender, conversations, adapter, messages, sendContext } = build();
    created(conversations);
    sendContext.get.mockResolvedValue(null);
    messages.markSendFailed.mockResolvedValue(message({ status: 'failed' }));

    await sender.send(data, { attemptsMade: 0 });

    expect(adapter.send).not.toHaveBeenCalled();
    expect(messages.markSendFailed).toHaveBeenCalledWith('msg-1', {
      code: null,
      message: 'Customer has no address on the conversation channel',
    });
  });
});

describe('AgentMessageSender media', () => {
  beforeEach(() => jest.clearAllMocks());

  const UPLOAD_ID = '0b9f6a3e-5c1d-4f7e-9a2b-3c4d5e6f7a8b';
  const imageJob: AgentSendJob = {
    ...data,
    msg: { type: 'image', uploadId: UPLOAD_ID, caption: 'Mira' },
  };
  const file = {
    storageUrl: `/uploads/co-1/${UPLOAD_ID}.png`,
    mimeType: 'image/png',
    filename: 'foto.png',
    sizeBytes: 2048,
    durationMs: null,
    width: 640,
    height: 480,
  };
  const attachment = {
    id: 'att-1',
    storageUrl: file.storageUrl,
    mimeType: 'image/png',
  };

  it('persists the staged file, uploads it once and sends it by provider id', async () => {
    const { sender, conversations, adapter, media, messages } = build();
    media.prepare.mockResolvedValue(file);
    conversations.saveOutbound.mockResolvedValue({ message: message(), created: true });
    media.attachmentOf.mockResolvedValue(attachment);
    media.toProvider.mockResolvedValue({ ok: true, providerMediaId: 'media-1' });
    adapter.send.mockResolvedValue({ ok: true, externalId: 'wamid-1' });
    messages.markSent.mockResolvedValue(message({ status: 'sent' }));

    await sender.send(imageJob);

    expect(conversations.saveOutbound).toHaveBeenCalledWith(
      'conv-1',
      {
        type: 'image',
        content: { body: 'Mira', filename: 'foto.png' },
        clientMessageId: 'client-1',
        mediaUrl: file.storageUrl,
        mimeType: 'image/png',
        sizeBytes: 2048,
        durationMs: null,
        width: 640,
        height: 480,
      },
      { id: 'member-1', type: 'member' },
      'co-1',
    );
    expect(media.toProvider).toHaveBeenCalledWith(
      adapter,
      { channelId: 'channel-1', companyId: 'co-1' },
      attachment,
    );
    expect(adapter.send).toHaveBeenCalledWith('channel-1', '51999000111', {
      type: 'image',
      media: { providerMediaId: 'media-1', mimeType: 'image/png' },
      caption: 'Mira',
    });
  });

  it('keeps a visible failed row when the upload expired', async () => {
    const { sender, conversations, adapter, media, messages } = build();
    media.prepare.mockRejectedValue(new Error('Upload not found or expired'));
    conversations.saveOutbound.mockResolvedValue({ message: message(), created: true });
    media.attachmentOf.mockResolvedValue(null);
    messages.markSendFailed.mockResolvedValue(message({ status: 'failed' }));

    await sender.send(imageJob);

    const [, content] = conversations.saveOutbound.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(content).not.toHaveProperty('mediaUrl');
    expect(adapter.send).not.toHaveBeenCalled();
    expect(messages.markSendFailed).toHaveBeenCalledWith('msg-1', {
      code: null,
      message: 'Upload not found or expired',
    });
  });

  it('retries a failed media row with the file it already holds', async () => {
    const { sender, conversations, adapter, media, messages } = build();
    // After 24 h the staged metadata is gone, but the row kept its file.
    media.prepare.mockRejectedValue(new Error('Upload not found or expired'));
    conversations.saveOutbound.mockResolvedValue({
      message: message({ status: 'failed' }),
      created: false,
    });
    messages.resetFailedForRetry.mockResolvedValue(message({ status: 'pending' }));
    media.attachmentOf.mockResolvedValue({ ...attachment, externalMediaId: 'media-1' });
    media.toProvider.mockResolvedValue({ ok: true, providerMediaId: 'media-1' });
    adapter.send.mockResolvedValue({ ok: true, externalId: 'wamid-2' });
    messages.markSent.mockResolvedValue(message({ status: 'sent' }));

    await sender.send(imageJob);

    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(messages.markSent).toHaveBeenCalledWith('msg-1', 'wamid-2');
  });

  it('fails the row when the provider refuses the upload', async () => {
    const { sender, conversations, adapter, media, messages } = build();
    media.prepare.mockResolvedValue(file);
    conversations.saveOutbound.mockResolvedValue({ message: message(), created: true });
    media.attachmentOf.mockResolvedValue(attachment);
    media.toProvider.mockResolvedValue({
      ok: false,
      error: { authFault: false, retryable: false, code: '131053', message: 'Media upload error' },
    });
    messages.markSendFailed.mockResolvedValue(message({ status: 'failed' }));

    await sender.send(imageJob);

    expect(adapter.send).not.toHaveBeenCalled();
    expect(messages.markSendFailed).toHaveBeenCalledWith('msg-1', {
      code: '131053',
      message: 'Media upload error',
    });
  });

  it('maps each media kind to its provider message', async () => {
    const { sender, conversations, adapter, media, messages } = build();
    conversations.saveOutbound.mockResolvedValue({ message: message(), created: true });
    media.prepare.mockResolvedValue(file);
    media.attachmentOf.mockResolvedValue(attachment);
    media.toProvider.mockResolvedValue({ ok: true, providerMediaId: 'media-1' });
    adapter.send.mockResolvedValue({ ok: true, externalId: 'wamid-1' });
    messages.markSent.mockResolvedValue(message({ status: 'sent' }));
    const providerMedia = { providerMediaId: 'media-1', mimeType: 'image/png' };

    const cases: Array<[AgentSendJob['msg'], unknown]> = [
      [{ type: 'audio', uploadId: UPLOAD_ID, voice: true }, { type: 'audio', media: providerMedia, voice: true }],
      [{ type: 'video', uploadId: UPLOAD_ID }, { type: 'video', media: providerMedia, caption: undefined }],
      [
        { type: 'document', uploadId: UPLOAD_ID, filename: 'cotizacion.pdf' },
        { type: 'document', media: providerMedia, filename: 'cotizacion.pdf', caption: undefined },
      ],
      [{ type: 'sticker', source: { attachmentId: 'att-9' } }, { type: 'sticker', media: providerMedia }],
    ];

    for (const [msg, expected] of cases) {
      adapter.send.mockClear();
      await sender.send({ ...data, msg });
      expect(adapter.send).toHaveBeenCalledWith('channel-1', '51999000111', expected);
    }
  });
});
