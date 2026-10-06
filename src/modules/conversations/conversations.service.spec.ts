import { ConversationsService } from './conversations.service';
import { MessageService } from '../message/message.service';

/**
 * T2/T3 row-first persist: `saveMsg` is the seam where the parsed inbound
 * payload becomes a message row (body + attachment). Every known type must
 * produce a visible row, and a media reference without a file yet is stored
 * as a pending attachment for the async enrichment.
 */
describe('ConversationsService.saveMsg (T2/T3 inbound types)', () => {
  const conversationRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: 'conv-1', companyId: 'co-1' }),
    update: jest.fn(),
  };

  const build = () => {
    const messageService = { saveMessage: jest.fn() };
    const members = {
      findOne: jest.fn().mockResolvedValue({ id: 'member-1' }),
    };
    const service = new ConversationsService(
      conversationRepo as never,
      {} as never,
      members as never,
      {} as never,
      {} as never,
      {} as never,
      messageService as unknown as MessageService,
      { setContext: jest.fn() } as never,
    );

    return { service, messageService };
  };

  beforeEach(() => jest.clearAllMocks());

  it('saves a playable audio row with the media attachment', async () => {
    const { service, messageService } = build();

    await service.saveMsg(
      'conv-1',
      {
        type: 'audio',
        mediaUrl: '/uploads/media-audio-1.ogg',
        externalId: 'wamid-audio-1',
        externalMediaId: 'media-audio-1',
        mimeType: 'audio/ogg',
        content: { link: '/uploads/media-audio-1.ogg' },
      },
      { id: 'cust-1', type: 'customer' },
      'co-1',
    );

    expect(messageService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'co-1',
        conversationId: 'conv-1',
        type: 'audio',
        direction: 'inbound',
        status: 'delivered',
        senderCustomerId: 'cust-1',
        externalId: 'wamid-audio-1',
        attachments: [
          {
            type: 'audio',
            mimeType: 'audio/ogg',
            fileName: undefined,
            storageUrl: '/uploads/media-audio-1.ogg',
            externalMediaId: 'media-audio-1',
            status: 'ready',
          },
        ],
      }),
    );
  });

  it('keeps the media reference as a pending attachment until enrichment', async () => {
    const { service, messageService } = build();

    await service.saveMsg(
      'conv-1',
      {
        type: 'image',
        externalId: 'wamid-image-1',
        externalMediaId: 'media-img-1',
        mimeType: 'image/jpeg',
        content: { caption: 'foto sin archivo' },
      },
      { id: 'cust-1', type: 'customer' },
      'co-1',
    );

    expect(messageService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'foto sin archivo',
        attachments: [
          expect.objectContaining({
            type: 'image',
            mimeType: 'image/jpeg',
            storageUrl: undefined,
            externalMediaId: 'media-img-1',
            status: 'pending',
          }),
        ],
      }),
    );
  });

  it('stores an already uploaded outbound file as a ready attachment', async () => {
    const { service, messageService } = build();

    await service.saveMsg(
      'conv-1',
      {
        type: 'image',
        mediaUrl: '/uploads/agent.jpg',
        content: { link: '/uploads/agent.jpg' },
      },
      { id: 'member-1', type: 'member' },
      'co-1',
    );

    expect(messageService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'outbound',
        attachments: [
          expect.objectContaining({
            type: 'image',
            storageUrl: '/uploads/agent.jpg',
            status: 'ready',
          }),
        ],
      }),
    );
  });

  it('saves a location as a readable body without attachment', async () => {
    const { service, messageService } = build();

    await service.saveMsg(
      'conv-1',
      {
        type: 'location',
        externalId: 'wamid-location-1',
        content: { body: '📍 Oficina: 4.60971, -74.08175' },
      },
      { id: 'cust-1', type: 'customer' },
      'co-1',
    );

    expect(messageService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'location',
        body: '📍 Oficina: 4.60971, -74.08175',
        attachments: undefined,
      }),
    );
  });
});
