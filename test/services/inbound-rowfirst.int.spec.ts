import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { of } from 'rxjs';
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
import { WhatsAppInboundReplayService } from '@integrations/whatsapp/intake/whatsapp-inbound-replay.service';
import { WhatsAppIntakeService } from '@integrations/whatsapp/intake/whatsapp-intake.service';
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
 * T2 acceptance over the real DB: an event persisted by T1 (crash between the
 * 200 and the save) replays from its stored payload into a visible
 * conversation row, and is consumed so it never replays twice.
 */
describe('Inbound row-first persist - integration', () => {
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
  let currentTransmission: ChannelTransmission | null = null;

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
    const messageService = new MessageService(messageRepository);

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
      {
        setChannel: jest.fn(),
        upload: jest.fn().mockReturnValue(
          of({
            fileUrl: '/uploads/media-audio-1.ogg',
            mimeType: 'audio/ogg',
            size: 10,
          }),
        ),
      } as never,
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
  });

  beforeEach(async () => {
    currentTransmission = null;
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

  it('replays a crash-persisted audio event into a playable row and consumes it', async () => {
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

    const attachment = await dataSource
      .getRepository(MessageAttachment)
      .findOneByOrFail({ messageId: message.id });
    expect(attachment).toMatchObject({
      type: 'audio',
      mimeType: 'audio/ogg',
      storageUrl: '/uploads/media-audio-1.ogg',
      externalMediaId: 'media-audio-1',
    });

    const savedConversation = await dataSource
      .getRepository(Conversation)
      .findOneByOrFail({ id: conversation.id });
    expect(savedConversation.lastMessageId).toBe(message.id);

    // Consumed: a second pass (e.g. next boot) has nothing to replay.
    await expect(replay.replayPending()).resolves.toBe(0);
    expect(await intake.listPending(10)).toEqual([]);
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
