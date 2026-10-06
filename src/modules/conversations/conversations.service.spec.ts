import { ConversationsService } from './conversations.service';
import { MessageService } from '../message/message.service';

/**
 * T2 row-first persist: `saveMsg` is the seam where the parsed inbound
 * payload becomes a message row (body + attachment). Every known type must
 * produce a visible row, and the attachment keeps the media reference even
 * when the download failed.
 */
describe('ConversationsService.saveMsg (T2 inbound types)', () => {
  const conversationRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: 'conv-1', companyId: 'co-1' }),
    update: jest.fn(),
  };

  const build = () => {
    const messageService = { saveMessage: jest.fn() };
    const service = new ConversationsService(
      conversationRepo as never,
      {} as never,
      {} as never,
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
          },
        ],
      }),
    );
  });

  it('keeps the attachment reference when the download failed', async () => {
    const { service, messageService } = build();

    await service.saveMsg(
      'conv-1',
      {
        type: 'image',
        externalId: 'wamid-image-1',
        externalMediaId: 'media-img-1',
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
            storageUrl: undefined,
            externalMediaId: 'media-img-1',
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
