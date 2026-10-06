import {
  ConversationSocketEvent,
  type ConversationMessageAttachmentPatch,
} from '../../../contracts/index';
import { MessageSavedEvent } from '../../../modules/conversations/events/message-saved.event';
import { InboundMediaEnrichmentHandler } from './inbound-media-enrichment.handler';
import type { ChannelTransmission } from '../../../modules/channels/channels.service';
import type { MessageAttachment } from '../../../modules/message/entities/message-attachment.entity';
import type { Message } from '../../../modules/message/entities/message.entity';
import type { MessageService } from '../../../modules/message/message.service';
import type { ConversationsService } from '../../../modules/conversations/conversations.service';
import type { ConversationGateway } from '../../../modules/conversations/gateways/conversation.gateway';
import type { ChannelsService } from '../../../modules/channels/channels.service';
import type { WhatsAppClient } from '../clients/whatsapp.client';
import { InboundMediaEnrichmentService } from './inbound-media-enrichment.service';

/**
 * T3 async enrichment: a saved row with a pending media reference is
 * completed in the background. Success stores the file and patches the
 * attachment as ready; any failure marks it failed and emits the failed
 * patch, but the message row (body/caption) is never deleted or emptied.
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

function build() {
  const messages = {
    findPendingMediaAttachments: jest.fn(),
    markAttachmentReady: jest.fn(),
    markAttachmentFailed: jest.fn(),
    saveMessage: jest.fn(),
  };
  const conversations = { findOne: jest.fn() };
  const channels = { getTransmissionByChannelId: jest.fn() };
  const client = { downloadMedia: jest.fn() };
  const emit = jest.fn();
  const gateway = { server: { to: jest.fn().mockReturnValue({ emit }) } };
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };

  const service = new InboundMediaEnrichmentService(
    messages as unknown as MessageService,
    conversations as unknown as ConversationsService,
    channels as unknown as ChannelsService,
    client as unknown as WhatsAppClient,
    gateway as unknown as ConversationGateway,
    logger as never,
  );

  return { service, messages, conversations, channels, client, gateway, emit, logger };
}

describe('InboundMediaEnrichmentService (T3)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores the downloaded media and emits the ready patch', async () => {
    const { service, messages, conversations, channels, client, gateway, emit } =
      build();
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

    await service.enrich(message());

    expect(channels.getTransmissionByChannelId).toHaveBeenCalledWith('chan-1');
    expect(client.downloadMedia).toHaveBeenCalledWith(
      transmission,
      'media-1',
      expect.any(Object),
    );
    expect(messages.markAttachmentReady).toHaveBeenCalledWith('att-1', {
      storageUrl: '/uploads/co-1/media-1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
    });
    expect(gateway.server.to).toHaveBeenCalledWith('conversation:conv-1');
    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.MessageAttachment,
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
  });

  it('marks the attachment failed and emits the failed patch without touching the row', async () => {
    const { service, messages, conversations, channels, client, emit } = build();
    messages.findPendingMediaAttachments.mockResolvedValue([attachment()]);
    conversations.findOne.mockResolvedValue({ id: 'conv-1', channelId: 'chan-1' });
    channels.getTransmissionByChannelId.mockResolvedValue(transmission);
    client.downloadMedia.mockRejectedValue(new Error('graph down'));
    messages.markAttachmentFailed.mockResolvedValue(
      attachment({ status: 'failed' }),
    );

    await service.enrich(message());

    expect(messages.markAttachmentFailed).toHaveBeenCalledWith('att-1');
    expect(messages.markAttachmentReady).not.toHaveBeenCalled();
    expect(messages.saveMessage).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.MessageAttachment,
      expect.objectContaining<Partial<ConversationMessageAttachmentPatch>>({
        id: 'msg-1',
        attachmentId: 'att-1',
        status: 'failed',
        url: null,
      }),
    );
  });

  it('fails every pending attachment when the channel transmission is gone', async () => {
    const { service, messages, conversations, channels, client, emit } = build();
    messages.findPendingMediaAttachments.mockResolvedValue([attachment()]);
    conversations.findOne.mockResolvedValue({ id: 'conv-1', channelId: 'chan-1' });
    channels.getTransmissionByChannelId.mockResolvedValue(null);
    messages.markAttachmentFailed.mockResolvedValue(
      attachment({ status: 'failed' }),
    );

    await service.enrich(message());

    expect(client.downloadMedia).not.toHaveBeenCalled();
    expect(messages.markAttachmentFailed).toHaveBeenCalledWith('att-1');
    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.MessageAttachment,
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('does nothing when the message has no pending media attachment', async () => {
    const { service, messages, conversations, client, emit } = build();
    messages.findPendingMediaAttachments.mockResolvedValue([]);

    await service.enrich(message());

    expect(conversations.findOne).not.toHaveBeenCalled();
    expect(client.downloadMedia).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('InboundMediaEnrichmentHandler (T3)', () => {
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    setContext: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('enriches the saved message', async () => {
    const enrich = jest.fn().mockResolvedValue(undefined);
    const handler = new InboundMediaEnrichmentHandler(
      { enrich } as unknown as InboundMediaEnrichmentService,
      logger as never,
    );
    const saved = message();

    await handler.handle(new MessageSavedEvent(saved));

    expect(enrich).toHaveBeenCalledWith(saved);
  });

  it('never lets an enrichment failure escape the event bus', async () => {
    const enrich = jest.fn().mockRejectedValue(new Error('boom'));
    const handler = new InboundMediaEnrichmentHandler(
      { enrich } as unknown as InboundMediaEnrichmentService,
      logger as never,
    );

    await expect(
      handler.handle(new MessageSavedEvent(message())),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });
});
