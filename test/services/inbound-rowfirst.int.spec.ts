import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, EntityTarget } from 'typeorm';

import * as Entities from '@entities';
import {
  ChannelFactory,
  CompanyFactory,
  ConversationFactory,
  CustomerFactory,
  MessageFactory,
} from '@factories';
import { MessageContentHandlers } from '@integrations/whatsapp/commands/handlers/message-content.handlers';
import { ReceiveWhatsAppMessageCommand } from '@integrations/whatsapp/commands/receive-whatsapp-message.command';
import { InboundMediaEnrichmentService } from '@integrations/whatsapp/intake/inbound-media-enrichment.service';
import { WhatsAppInboundReplayService } from '@integrations/whatsapp/intake/whatsapp-inbound-replay.service';
import { WhatsAppIntakeService } from '@integrations/whatsapp/intake/whatsapp-intake.service';
import { ConversationSocketEvent } from '../../src/contracts/index';
import type { ChannelTransmission } from '@modules/channels/channels.service';
import { SaveConversationMessageCommand } from '@modules/conversations/commands/save-conversation-message.command';
import { ConversationRepository } from '@modules/conversations/conversation.repository';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { Conversation } from '@modules/conversations/entities/conversation.entity';
import { ConversationAssignment } from '@modules/conversations/entities/conversation-assignment.entity';
import { CompanyMember } from '@modules/company-members/entities/company-member.entity';
import { CustomersService } from '@modules/customers/customers.service';
import { Customer } from '@modules/customers/entities/customer.entity';
import { CustomerIdentity } from '@modules/customers/entities/customer-identity.entity';
import { MessageAttachment } from '@modules/message/entities/message-attachment.entity';
import { Message } from '@modules/message/entities/message.entity';
import { MessageRepository } from '@modules/message/message.repository';
import { MessageService } from '@modules/message/message.service';
import { getTestConfig, truncateAllTables } from '../helpers/test-database.helper';

const entities = Object.values(Entities) as EntityTarget<unknown>[];

jest.setTimeout(120_000);

const logger = () =>
  ({
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  }) as never;

/**
 * T2/T3 acceptance over the real DB: an event persisted by T1 (crash between
 * the 200 and the save) replays from its stored payload into a visible
 * conversation row whose media is a `pending` reference; the async enrichment
 * then stores the file (ready) or marks it failed without touching the row.
 */
describe('Inbound row-first persist + media enrichment - integration', () => {
  const AUDIO_WAMID = 'wamid-int-audio-1';
  const audioPayload = {
    id: AUDIO_WAMID,
    from: '15551234567',
    timestamp: '1760000000',
    type: 'audio',
    audio: { id: 'media-audio-1', mime_type: 'audio/ogg' },
  };

  let module: TestingModule;
  let dataSource: DataSource;
  let intake: WhatsAppIntakeService;
  let replay: WhatsAppInboundReplayService;
  let enrichment: InboundMediaEnrichmentService;
  let messageService: MessageService;
  let currentTransmission: ChannelTransmission | null = null;

  const downloadMedia = jest.fn();
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });

  const commandBus = {
    // Replaced in beforeAll with a loopback bus that replaces the BullMQ queue
    // (process infrastructure) with a direct call to the same save path, so
    // the test observes real rows.
    execute: (_command: unknown): Promise<unknown> => {
      throw new Error('Loopback bus not wired yet');
    },
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot(getTestConfig(entities))],
    }).compile();

    dataSource = module.get<DataSource>(getDataSourceToken());

    intake = new WhatsAppIntakeService(
      dataSource.getRepository(Entities.WhatsappInboundEvent),
      logger(),
    );

    const messageRepository = new MessageRepository(
      dataSource.getRepository(Message),
      dataSource.getRepository(MessageAttachment),
      dataSource,
    );
    messageService = new MessageService(messageRepository);

    const customers = new CustomersService(
      dataSource.getRepository(Customer),
      dataSource.getRepository(CustomerIdentity),
      {} as never,
      { get: () => undefined } as never,
    );
    const conversationRepository = new ConversationRepository(
      dataSource,
      customers,
    );

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

    const handlers = new MessageContentHandlers(
      conversationRepository,
      commandBus as never,
      logger(),
    );

    // Wire the two pipeline commands the replay path emits.
    commandBus.execute = async (command: unknown): Promise<unknown> => {
      if (command instanceof ReceiveWhatsAppMessageCommand) {
        if (!currentTransmission) throw new Error('No transmission configured');
        const { context, content } = command.message;
        await handlers
          .getHandler(content.type)
          ?.handle(content, context, currentTransmission);
        return undefined;
      }
      if (command instanceof SaveConversationMessageCommand) {
        const data = command.data as never as {
          room: string;
          companyId?: string;
          sender: { id: string; type: 'customer' };
          msg: {
            type: string;
            content: Record<string, unknown>;
            mediaUrl?: string;
            externalId?: string;
            externalMediaId?: string;
            mimeType?: string;
          };
        };
        return conversations.saveMsg(data.room, data.msg as never, data.sender, data.companyId);
      }
      throw new Error('Unexpected command in integration loopback bus');
    };

    replay = new WhatsAppInboundReplayService(
      intake,
      messageService,
      commandBus as never,
      logger(),
    );

    enrichment = new InboundMediaEnrichmentService(
      messageService,
      conversations,
      {
        getTransmissionByChannelId: jest.fn(() =>
          Promise.resolve(currentTransmission),
        ),
      } as never,
      { downloadMedia } as never,
      { server: { to } } as never,
      logger(),
    );
  });

  beforeEach(async () => {
    currentTransmission = null;
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
    const channel = await ChannelFactory.transient({ manager }).create({
      companyId: company.id,
      externalAccountId: 'phone-1',
    });
    const customer = await CustomerFactory.transient({ manager }).create({
      companyId: company.id,
      phoneNumber: '+15551234567',
    });
    const conversation = await ConversationFactory.transient({ manager }).create({
      companyId: company.id,
      channelId: channel.id,
      customerId: customer.id,
    });

    currentTransmission = {
      channel,
      credentials: { accessToken: 'token-1' },
    };

    return { company, channel, customer, conversation };
  }

  it('replays a crash-persisted audio event into a pending row and enriches it to ready', async () => {
    const { conversation } = await setupConversation();
    await intake.persistIfNew({
      wamid: AUDIO_WAMID,
      phoneNumberId: 'phone-1',
      messageType: 'audio',
      payload: audioPayload,
    });

    await expect(replay.replayPending()).resolves.toBe(1);

    const message = await dataSource
      .getRepository(Message)
      .findOneByOrFail({ externalId: AUDIO_WAMID });
    expect(message).toMatchObject({
      type: 'audio',
      direction: 'inbound',
      senderType: 'customer',
      conversationId: conversation.id,
      status: 'delivered',
    });

    const pendingAttachment = await dataSource
      .getRepository(MessageAttachment)
      .findOneByOrFail({ messageId: message.id });
    expect(pendingAttachment).toMatchObject({
      type: 'audio',
      mimeType: 'audio/ogg',
      externalMediaId: 'media-audio-1',
      status: 'pending',
    });
    expect(pendingAttachment.storageUrl ?? null).toBeNull();

    // Async enrichment: the file lands in the company folder and the row gets
    // the ready patch without being re-saved.
    downloadMedia.mockResolvedValue({
      fileUrl: '/uploads/co-test/media-audio-1.ogg',
      mimeType: 'audio/ogg',
      sizeBytes: 10,
    });

    await enrichment.enrich(message);

    const enriched = await dataSource
      .getRepository(MessageAttachment)
      .findOneByOrFail({ id: pendingAttachment.id });
    expect(enriched).toMatchObject({
      status: 'ready',
      storageUrl: '/uploads/co-test/media-audio-1.ogg',
      sizeBytes: 10,
    });
    expect(
      await dataSource.getRepository(Message).findOneByOrFail({ id: message.id }),
    ).toMatchObject({ type: 'audio', externalId: AUDIO_WAMID });

    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.MessageAttachment,
      expect.objectContaining({
        id: message.id,
        conversationId: conversation.id,
        attachmentId: pendingAttachment.id,
        status: 'ready',
        url: '/uploads/co-test/media-audio-1.ogg',
      }),
    );

    // Idempotent: a second enrichment pass finds nothing pending and emits
    // no duplicate patch.
    downloadMedia.mockClear();
    emit.mockClear();
    await enrichment.enrich(message);
    expect(downloadMedia).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();

    // Consumed: a second pass (e.g. next boot) has nothing to replay.
    await expect(replay.replayPending()).resolves.toBe(0);
    expect(await intake.listPending(10)).toEqual([]);
  });

  it('keeps the row with its caption when the media enrichment fails', async () => {
    const { conversation } = await setupConversation();
    await intake.persistIfNew({
      wamid: 'wamid-int-image-1',
      phoneNumberId: 'phone-1',
      messageType: 'image',
      payload: {
        id: 'wamid-int-image-1',
        from: '15551234567',
        timestamp: '1760000002',
        type: 'image',
        image: { id: 'media-img-1', caption: 'mira esto', mime_type: 'image/jpeg' },
      },
    });

    await expect(replay.replayPending()).resolves.toBe(1);

    const message = await dataSource
      .getRepository(Message)
      .findOneByOrFail({ externalId: 'wamid-int-image-1' });
    expect(message).toMatchObject({
      type: 'image',
      body: 'mira esto',
      conversationId: conversation.id,
    });

    const pendingAttachment = await dataSource
      .getRepository(MessageAttachment)
      .findOneByOrFail({ messageId: message.id });
    expect(pendingAttachment.status).toBe('pending');

    downloadMedia.mockRejectedValue(new Error('graph down'));

    await enrichment.enrich(message);

    const failed = await dataSource
      .getRepository(MessageAttachment)
      .findOneByOrFail({ id: pendingAttachment.id });
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed.storageUrl ?? null).toBeNull();

    // The row survives with its caption: a failed file never empties it.
    const kept = await dataSource
      .getRepository(Message)
      .findOneByOrFail({ id: message.id });
    expect(kept).toMatchObject({ body: 'mira esto', type: 'image' });
    expect(kept.deletedAt ?? null).toBeNull();

    expect(emit).toHaveBeenCalledWith(
      ConversationSocketEvent.MessageAttachment,
      expect.objectContaining({
        id: message.id,
        attachmentId: pendingAttachment.id,
        status: 'failed',
        url: null,
      }),
    );

    // History stays honest after a reload: the failed state travels in the
    // same payload the thread already consumes.
    await expect(messageService.getMessagePayload(message.id)).resolves.toMatchObject({
      msg: { type: 'image', mediaUrl: null, attachmentStatus: 'failed' },
    });
  });

  it('replays a location event as a short readable row', async () => {
    await setupConversation();
    await intake.persistIfNew({
      wamid: 'wamid-int-location-1',
      phoneNumberId: 'phone-1',
      messageType: 'location',
      payload: {
        id: 'wamid-int-location-1',
        from: '15551234567',
        timestamp: '1760000001',
        type: 'location',
        location: {
          latitude: 4.60971,
          longitude: -74.08175,
          name: 'Oficina',
        },
      },
    });

    await expect(replay.replayPending()).resolves.toBe(1);

    const message = await dataSource
      .getRepository(Message)
      .findOneByOrFail({ externalId: 'wamid-int-location-1' });
    expect(message).toMatchObject({
      type: 'location',
      body: '📍 Oficina: 4.60971, -74.08175',
    });
    expect(
      await dataSource
        .getRepository(MessageAttachment)
        .countBy({ messageId: message.id }),
    ).toBe(0);
  });

  it('consumes without a second row when the wamid is already persisted', async () => {
    const { conversation } = await setupConversation();
    await intake.persistIfNew({
      wamid: AUDIO_WAMID,
      phoneNumberId: 'phone-1',
      messageType: 'audio',
      payload: audioPayload,
    });
    await MessageFactory.transient({ manager: dataSource.manager }).create({
      conversationId: conversation.id,
      externalId: AUDIO_WAMID,
      type: 'audio',
    });

    await expect(replay.replayPending()).resolves.toBe(0);

    expect(await dataSource.getRepository(Message).count()).toBe(1);
    expect(await intake.listPending(10)).toEqual([]);
  });
});
