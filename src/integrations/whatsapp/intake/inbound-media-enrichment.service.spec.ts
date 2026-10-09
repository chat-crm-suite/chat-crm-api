// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { type ConversationMessageAttachmentPatch } from '../../../contracts/index';
import { MessageSavedEvent } from '../../../modules/conversations/events/message-saved.event';
import { InboundMediaEnrichmentHandler } from './inbound-media-enrichment.handler';
import type { ChannelTransmission } from '../../../modules/channels/channels.service';
import type { MessageAttachment } from '../../../modules/message/entities/message-attachment.entity';
import type { Message } from '../../../modules/message/entities/message.entity';
import type { MessageService } from '../../../modules/message/message.service';
import type { ConversationsService } from '../../../modules/conversations/conversations.service';
import type { ConversationFanoutService } from '../../../modules/conversations/realtime/conversation-fanout.service';
import type { ChannelsService } from '../../../modules/channels/channels.service';
import {
  WhatsAppMediaTooLargeError,
  type WhatsAppClient,
} from '../clients/whatsapp.client';
import { InboundMediaEnrichedEvent } from '../events/inbound-media-enriched.event';
import { InboundMediaFailedEvent } from '../events/inbound-media-failed.event';
import { InboundMediaEnrichmentService } from './inbound-media-enrichment.service';
import {
  ENRICH_MEDIA_ATTEMPTS,
  ENRICH_MEDIA_JOB,
  ENRICH_MEDIA_TIMEOUT_MS,
} from './enrich-media.queue';

/**
 * T23 async enrichment: the message row is saved first with a `pending`
 * attachment; a dedicated `enrich-media` queue job downloads the file with a
 * retry budget. Success flips the attachment to `ready` and emits exactly one
 * patch; exhausting the budget flips it to `failed`, keeps the row and emits
 * exactly one failed patch. A retry over an already settled attachment (or a
 * concurrent pass that won the transition) never emits a second patch. The
 * patch leaves through the single fanout path (T6).
 */
const transmission = {
  channel: { id: 'chan-1', companyId: 'co-1' },
  credentials: { accessToken: 'token-1' },
} as unknown as ChannelTransmission;

const message = (): Message =>
  ({
    id: 'msg-1',
    conversationId: 'conv-1',
    companyId: 'co-1',
    type: 'image',
    body: 'mira',
  }) as Message;

const attachment = (
  overrides: Partial<MessageAttachment> = {},
): MessageAttachment =>
  ({
    id: 'att-1',
    messageId: 'msg-1',
    type: 'image',
    mimeType: 'image/jpeg',
    externalMediaId: 'media-1',
    status: 'pending',
    ...overrides,
  }) as MessageAttachment;

/** First BullMQ attempt: a retryable fault must rethrow for the retry. */
const firstAttempt = { attemptsMade: 0, maxAttempts: ENRICH_MEDIA_ATTEMPTS };
/** Final BullMQ attempt: a failure settles the attachment, no retry left. */
const finalAttempt = {
  attemptsMade: ENRICH_MEDIA_ATTEMPTS - 1,
  maxAttempts: ENRICH_MEDIA_ATTEMPTS,
};

const retryableFault = () =>
  Object.assign(new Error('graph 500'), { response: { status: 500 } });

function build() {
  const messages = {
    findById: jest.fn(),
    findPendingMediaAttachments: jest.fn(),
    markAttachmentReady: jest.fn(),
    markAttachmentFailed: jest.fn(),
    saveMessage: jest.fn(),
  };
  const conversations = { findOne: jest.fn() };
  const channels = { getTransmissionByChannelId: jest.fn() };
  const client = { downloadMedia: jest.fn() };
  const fanout = {
    emitAttachmentPatch: jest.fn().mockResolvedValue(undefined),
  };
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };
  const eventBus = { publish: jest.fn() };

  const service = new InboundMediaEnrichmentService(
    messages as unknown as MessageService,
    conversations as unknown as ConversationsService,
    channels as unknown as ChannelsService,
    client as unknown as WhatsAppClient,
    fanout as unknown as ConversationFanoutService,
    logger as never,
    eventBus as never,
  );

  return {
    service,
    messages,
    conversations,
    channels,
    client,
    fanout,
    logger,
    eventBus,
  };
}

/** Wires a successful download; callers tweak the pieces they exercise. */
function wireReadyMedia(
  messages: ReturnType<typeof build>['messages'],
  conversations: ReturnType<typeof build>['conversations'],
  channels: ReturnType<typeof build>['channels'],
  client: ReturnType<typeof build>['client'],
) {
  messages.findPendingMediaAttachments.mockResolvedValue([attachment()]);
  conversations.findOne.mockResolvedValue({ id: 'conv-1', channelId: 'chan-1' });
  channels.getTransmissionByChannelId.mockResolvedValue(transmission);
  client.downloadMedia.mockResolvedValue({
    fileUrl: '/uploads/co-1/media-1.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 10,
  });
  messages.markAttachmentReady.mockResolvedValue(
    attachment({
      status: 'ready',
      storageUrl: '/uploads/co-1/media-1.jpg',
      sizeBytes: 10,
    }),
  );
}

describe('InboundMediaEnrichmentService (T23)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores the downloaded media and emits exactly one ready patch', async () => {
    const { service, messages, conversations, channels, client, fanout, eventBus } =
      build();
    wireReadyMedia(messages, conversations, channels, client);

    await service.enrich(message(), finalAttempt);

    expect(client.downloadMedia).toHaveBeenCalledWith(
      transmission,
      'media-1',
      expect.objectContaining({
        maxBytes: 16 * 1024 * 1024,
        timeoutMs: ENRICH_MEDIA_TIMEOUT_MS,
      }),
    );
    expect(messages.markAttachmentReady).toHaveBeenCalledWith('att-1', {
      storageUrl: '/uploads/co-1/media-1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
    });
    expect(fanout.emitAttachmentPatch).toHaveBeenCalledTimes(1);
    expect(fanout.emitAttachmentPatch).toHaveBeenCalledWith(
      expect.objectContaining<Partial<ConversationMessageAttachmentPatch>>({
        id: 'msg-1',
        conversationId: 'conv-1',
        attachmentId: 'att-1',
        status: 'ready',
        url: '/uploads/co-1/media-1.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.any(InboundMediaEnrichedEvent),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-1',
        attachmentId: 'att-1',
        mediaId: 'media-1',
        type: 'image',
      }),
    );
  });

  it('bounds the download by the attachment type size limit', async () => {
    const { service, messages, conversations, channels, client } = build();
    wireReadyMedia(messages, conversations, channels, client);
    messages.findPendingMediaAttachments.mockResolvedValue([
      attachment({ type: 'video' }),
    ]);

    await service.enrich(message(), finalAttempt);

    expect(client.downloadMedia).toHaveBeenCalledWith(
      transmission,
      'media-1',
      expect.objectContaining({ maxBytes: 64 * 1024 * 1024 }),
    );
  });

  it('marks failed with one failed patch and keeps the row on exhaustion', async () => {
    const { service, messages, conversations, channels, client, fanout, eventBus } =
      build();
    messages.findPendingMediaAttachments.mockResolvedValue([attachment()]);
    conversations.findOne.mockResolvedValue({
      id: 'conv-1',
      channelId: 'chan-1',
    });
    channels.getTransmissionByChannelId.mockResolvedValue(transmission);
    client.downloadMedia.mockRejectedValue(retryableFault());
    messages.markAttachmentFailed.mockResolvedValue(
      attachment({ status: 'failed' }),
    );

    await service.enrich(message(), finalAttempt);

    expect(messages.markAttachmentFailed).toHaveBeenCalledWith('att-1');
    expect(messages.markAttachmentReady).not.toHaveBeenCalled();
    expect(messages.saveMessage).not.toHaveBeenCalled();
    expect(fanout.emitAttachmentPatch).toHaveBeenCalledTimes(1);
    expect(fanout.emitAttachmentPatch).toHaveBeenCalledWith(
      expect.objectContaining<Partial<ConversationMessageAttachmentPatch>>({
        id: 'msg-1',
        attachmentId: 'att-1',
        status: 'failed',
        url: null,
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.any(InboundMediaFailedEvent),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-1',
        attachmentId: 'att-1',
        mediaId: 'media-1',
        type: 'image',
        retryable: true,
      }),
    );
  });

  it('rethrows a retryable fault before the last attempt so BullMQ retries', async () => {
    const { service, messages, conversations, channels, client, fanout } =
      build();
    messages.findPendingMediaAttachments.mockResolvedValue([attachment()]);
    conversations.findOne.mockResolvedValue({
      id: 'conv-1',
      channelId: 'chan-1',
    });
    channels.getTransmissionByChannelId.mockResolvedValue(transmission);
    client.downloadMedia.mockRejectedValue(retryableFault());

    await expect(service.enrich(message(), firstAttempt)).rejects.toThrow(
      'graph 500',
    );

    expect(messages.markAttachmentFailed).not.toHaveBeenCalled();
    expect(fanout.emitAttachmentPatch).not.toHaveBeenCalled();
  });

  it('fails immediately on a terminal fault even on the first attempt', async () => {
    const { service, messages, conversations, channels, client, fanout, eventBus } =
      build();
    messages.findPendingMediaAttachments.mockResolvedValue([attachment()]);
    conversations.findOne.mockResolvedValue({
      id: 'conv-1',
      channelId: 'chan-1',
    });
    channels.getTransmissionByChannelId.mockResolvedValue(transmission);
    client.downloadMedia.mockRejectedValue(
      new WhatsAppMediaTooLargeError('media-1', 999, 10),
    );
    messages.markAttachmentFailed.mockResolvedValue(
      attachment({ status: 'failed' }),
    );

    await service.enrich(message(), firstAttempt);

    expect(messages.markAttachmentFailed).toHaveBeenCalledWith('att-1');
    expect(fanout.emitAttachmentPatch).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: 'att-1',
        mediaId: 'media-1',
        retryable: false,
      }),
    );
  });

  it('is a noop when the attachment is already settled (idempotent retry)', async () => {
    const { service, messages, conversations, client, fanout } = build();
    messages.findPendingMediaAttachments.mockResolvedValue([]);

    await service.enrich(message(), finalAttempt);

    expect(conversations.findOne).not.toHaveBeenCalled();
    expect(client.downloadMedia).not.toHaveBeenCalled();
    expect(fanout.emitAttachmentPatch).not.toHaveBeenCalled();
  });

  it('emits no second patch when a concurrent pass settled it to ready', async () => {
    const { service, messages, conversations, channels, client, fanout } =
      build();
    wireReadyMedia(messages, conversations, channels, client);
    messages.markAttachmentReady.mockResolvedValue(null);

    await service.enrich(message(), finalAttempt);

    expect(fanout.emitAttachmentPatch).not.toHaveBeenCalled();
  });

  it('emits no second patch when a concurrent pass already failed it', async () => {
    const { service, messages, conversations, channels, client, fanout } =
      build();
    messages.findPendingMediaAttachments.mockResolvedValue([attachment()]);
    conversations.findOne.mockResolvedValue({
      id: 'conv-1',
      channelId: 'chan-1',
    });
    channels.getTransmissionByChannelId.mockResolvedValue(transmission);
    client.downloadMedia.mockRejectedValue(retryableFault());
    messages.markAttachmentFailed.mockResolvedValue(null);

    await service.enrich(message(), finalAttempt);

    expect(fanout.emitAttachmentPatch).not.toHaveBeenCalled();
  });

  it('fails the attachment when the channel transmission is gone', async () => {
    const { service, messages, conversations, channels, client, fanout } =
      build();
    messages.findPendingMediaAttachments.mockResolvedValue([attachment()]);
    conversations.findOne.mockResolvedValue({
      id: 'conv-1',
      channelId: 'chan-1',
    });
    channels.getTransmissionByChannelId.mockResolvedValue(null);
    messages.markAttachmentFailed.mockResolvedValue(
      attachment({ status: 'failed' }),
    );

    await service.enrich(message(), finalAttempt);

    expect(client.downloadMedia).not.toHaveBeenCalled();
    expect(messages.markAttachmentFailed).toHaveBeenCalledWith('att-1');
    expect(fanout.emitAttachmentPatch).toHaveBeenCalledTimes(1);
  });

  it('fails every pending attachment when the lookup throws on the last attempt', async () => {
    const { service, messages, conversations, client, fanout, eventBus } =
      build();
    messages.findPendingMediaAttachments.mockResolvedValue([attachment()]);
    conversations.findOne.mockRejectedValue(new Error('decrypt failed'));
    messages.markAttachmentFailed.mockResolvedValue(
      attachment({ status: 'failed' }),
    );

    await service.enrich(message(), finalAttempt);

    expect(client.downloadMedia).not.toHaveBeenCalled();
    expect(messages.markAttachmentFailed).toHaveBeenCalledWith('att-1');
    expect(fanout.emitAttachmentPatch).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.any(InboundMediaFailedEvent),
    );
  });

  it('rethrows a retryable lookup failure before the last attempt', async () => {
    const { service, messages, conversations, fanout } = build();
    messages.findPendingMediaAttachments.mockResolvedValue([attachment()]);
    conversations.findOne.mockRejectedValue(retryableFault());

    await expect(service.enrich(message(), firstAttempt)).rejects.toThrow(
      'graph 500',
    );

    expect(messages.markAttachmentFailed).not.toHaveBeenCalled();
    expect(fanout.emitAttachmentPatch).not.toHaveBeenCalled();
  });

  it('rehydrates the row by id and enriches its pending media', async () => {
    const { service, messages, conversations, channels, client, fanout } =
      build();
    messages.findById.mockResolvedValue(message());
    wireReadyMedia(messages, conversations, channels, client);

    await service.enrichById('msg-1', finalAttempt);

    expect(messages.findById).toHaveBeenCalledWith('msg-1');
    expect(messages.markAttachmentReady).toHaveBeenCalled();
    expect(fanout.emitAttachmentPatch).toHaveBeenCalledTimes(1);
  });

  it('noops when the row no longer exists', async () => {
    const { service, messages, fanout } = build();
    messages.findById.mockResolvedValue(null);

    await service.enrichById('msg-1', finalAttempt);

    expect(messages.findPendingMediaAttachments).not.toHaveBeenCalled();
    expect(fanout.emitAttachmentPatch).not.toHaveBeenCalled();
  });
});

describe('InboundMediaEnrichmentHandler (T23 queue)', () => {
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };

  function buildHandler() {
    const add = jest.fn<Promise<{ id: string }>, [string, unknown, unknown]>();
    add.mockResolvedValue({ id: 'job-1' });
    const queue = { add };
    const handler = new InboundMediaEnrichmentHandler(
      queue as never,
      logger as never,
    );

    return { handler, queue };
  }

  beforeEach(() => jest.clearAllMocks());

  it('only enqueues one enrich-media job with retry options and returns', async () => {
    const { handler, queue } = buildHandler();

    await handler.handle(new MessageSavedEvent(message()));

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      ENRICH_MEDIA_JOB,
      { messageId: 'msg-1' },
      expect.objectContaining({ attempts: ENRICH_MEDIA_ATTEMPTS }),
    );

    const options = queue.add.mock.calls[0][2] as {
      backoff: { type: string; delay: number };
    };
    expect(options.backoff.type).toBe('exponential');
    expect(options.backoff.delay).toBeGreaterThan(0);
  });

  it('never lets an enqueue failure escape the event bus', async () => {
    const { handler, queue } = buildHandler();
    queue.add.mockRejectedValue(new Error('redis down'));

    await expect(
      handler.handle(new MessageSavedEvent(message())),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });
});
