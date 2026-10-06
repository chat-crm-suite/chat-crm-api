import type { ChannelsService, ChannelTransmission } from '../../modules/channels/channels.service';
import { FailWhatsAppMessageCommand } from '../../modules/conversations/commands/fail-whatsapp-message.command';
import type { WhatsAppClient } from './clients/whatsapp.client';
import type { WhatsAppPayload } from './interfaces/whatsapp-message.interface';
import { WhatsAppService } from './whatsapp.service';

/**
 * T3 failure policy at the facade: a send that ends in an authorization fault
 * (or in exhausted transport retries) surfaces as a visible failure — the
 * thread gets the error event — instead of dying silently in a log. The
 * retry policy itself lives in the stateless client.
 */
const payload: WhatsAppPayload = {
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to: '15551234567',
  type: 'text',
  text: { body: 'hola' },
};

const transmission = {
  channel: { id: 'chan-1', companyId: 'co-1' },
  credentials: { accessToken: 'token-1' },
} as unknown as ChannelTransmission;

const axiosError = (status: number, data?: unknown) =>
  Object.assign(new Error(`Request failed with status ${status}`), {
    isAxiosError: true,
    response: { status, data },
    config: {},
  });

function build() {
  const channels = { getTransmissionForCompany: jest.fn() };
  const client = { send: jest.fn() };
  const cls = { get: jest.fn().mockReturnValue('co-1') };
  const commandBus = {
    execute: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(undefined),
  };
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };

  const service = new WhatsAppService(
    channels as unknown as ChannelsService,
    client as unknown as WhatsAppClient,
    cls as never,
    commandBus as never,
    logger as never,
  );

  return { service, channels, client, cls, commandBus, logger };
}

describe('WhatsAppService.sendMessage (T3 failure visibility)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends through the transmission resolved for the company', async () => {
    const { service, channels, client, commandBus } = build();
    channels.getTransmissionForCompany.mockResolvedValue(transmission);
    client.send.mockResolvedValue({ messages: [{ id: 'wamid-1' }] });

    await expect(service.sendMessage(payload, 'co-1')).resolves.toEqual({
      messages: [{ id: 'wamid-1' }],
    });

    expect(channels.getTransmissionForCompany).toHaveBeenCalledWith('co-1');
    expect(client.send).toHaveBeenCalledWith(payload, transmission);
    expect(commandBus.execute).not.toHaveBeenCalled();
  });

  it('surfaces an authorization fault as a visible failure immediately', async () => {
    const { service, channels, client, commandBus } = build();
    channels.getTransmissionForCompany.mockResolvedValue(transmission);
    client.send.mockRejectedValue(
      axiosError(401, {
        error: { type: 'OAuthException', code: 190, message: 'expired token' },
      }),
    );

    await expect(service.sendMessage(payload, 'co-1')).resolves.toBeUndefined();

    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    const command = commandBus.execute.mock
      .calls[0][0] as FailWhatsAppMessageCommand;
    expect(command).toBeInstanceOf(FailWhatsAppMessageCommand);
    expect(command.recipientId).toBe('15551234567');
    expect(command.err).toMatchObject({
      code: 190,
      message: 'expired token',
    });
  });

  it('surfaces a transport fault once the client retries are exhausted', async () => {
    const { service, channels, client, commandBus } = build();
    channels.getTransmissionForCompany.mockResolvedValue(transmission);
    client.send.mockRejectedValue(
      Object.assign(new Error('socket hang up'), {
        isAxiosError: true,
        code: 'ECONNRESET',
      }),
    );

    await expect(service.sendMessage(payload, 'co-1')).resolves.toBeUndefined();

    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    expect(commandBus.execute.mock.calls[0][0]).toBeInstanceOf(
      FailWhatsAppMessageCommand,
    );
  });

  it('does nothing when the company has no active channel', async () => {
    const { service, channels, client, commandBus, logger } = build();
    channels.getTransmissionForCompany.mockResolvedValue(null);

    await expect(service.sendMessage(payload, 'co-1')).resolves.toBeUndefined();

    expect(client.send).not.toHaveBeenCalled();
    expect(commandBus.execute).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('does nothing without a company context', async () => {
    const { service, channels, client, cls, commandBus, logger } = build();
    cls.get.mockReturnValue(undefined);

    await expect(service.sendMessage(payload)).resolves.toBeUndefined();

    expect(channels.getTransmissionForCompany).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
    expect(commandBus.execute).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
