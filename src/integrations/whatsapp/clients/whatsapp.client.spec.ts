import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { of, throwError } from 'rxjs';

import type { ChannelTransmission } from '../../../modules/channels/channels.service';
import type { WhatsAppPayload } from '../interfaces/whatsapp-message.interface';
import { WhatsAppClient } from './whatsapp.client';

/**
 * T3 stateless provider: every operation carries its transmission (Graph
 * version/base URL from the channel, matching token and phone id), so two
 * companies can never mix credentials and no process-wide axios default is
 * ever mutated. Transport/server faults retry with backoff; authorization
 * faults fail immediately.
 */
const payload: WhatsAppPayload = {
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to: '15551234567',
  type: 'text',
  text: { body: 'hola' },
};

const transmission = (overrides: {
  companyId?: string;
  phoneNumberId?: string;
  token?: string;
  apiVersion?: string;
  apiBaseUrl?: string;
} = {}): ChannelTransmission =>
  ({
    channel: {
      id: `chan-${overrides.phoneNumberId ?? 'phone-a'}`,
      companyId: overrides.companyId ?? 'co-1',
      externalAccountId: overrides.phoneNumberId ?? 'phone-a',
      settings: {
        apiVersion: overrides.apiVersion ?? 'v21.0',
        apiBaseUrl: overrides.apiBaseUrl ?? 'https://graph.example.com',
      },
    },
    credentials: { accessToken: overrides.token ?? 'token-a' },
  }) as unknown as ChannelTransmission;

const axiosError = (status: number, data?: unknown) =>
  Object.assign(new Error(`Request failed with status ${status}`), {
    isAxiosError: true,
    code: `E${status}`,
    response: { status, data },
    config: {},
  });

const networkError = () =>
  Object.assign(new Error('socket hang up'), {
    isAxiosError: true,
    code: 'ECONNRESET',
    config: {},
  });

interface HttpMock {
  post: jest.Mock<unknown, [string, unknown, { headers: Record<string, string> }]>;
  get: jest.Mock<
    unknown,
    [
      string,
      {
        headers?: Record<string, string>;
        timeout?: number;
        responseType?: string;
      },
    ]
  >;
  axiosRef: {
    defaults: {
      baseURL?: string;
      headers: { common: Record<string, unknown> };
    };
  };
}

function buildHttp(): HttpMock {
  return {
    post: jest.fn<
      unknown,
      [string, unknown, { headers: Record<string, string> }]
    >(),
    get: jest.fn<
      unknown,
      [
        string,
        {
          headers?: Record<string, string>;
          timeout?: number;
          responseType?: string;
        },
      ]
    >(),
    axiosRef: {
      defaults: {
        headers: { common: {} },
      },
    },
  };
}

const logger = {
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  setContext: jest.fn(),
} as never;

describe('WhatsAppClient.send (T3 stateless transmission)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends through the transmission Graph version, base URL and phone id', async () => {
    const http = buildHttp();
    http.post.mockReturnValue(of({ data: { messages: [{ id: 'wamid-1' }] } }));
    const client = new WhatsAppClient(http as never, logger);

    const result = await client.send(payload, transmission());

    const [url, body, config] = http.post.mock.calls[0];
    expect(url).toBe('https://graph.example.com/v21.0/phone-a/messages');
    expect(body).toBe(payload);
    expect(config.headers.Authorization).toBe('Bearer token-a');
    expect(result).toEqual({ messages: [{ id: 'wamid-1' }] });
  });

  it('never mixes credentials or phone identity of concurrent companies', async () => {
    const http = buildHttp();
    http.post.mockReturnValue(of({ data: { messages: [{ id: 'wamid-1' }] } }));
    const client = new WhatsAppClient(http as never, logger);

    await Promise.all([
      client.send(payload, transmission()),
      client.send(
        payload,
        transmission({
          companyId: 'co-2',
          phoneNumberId: 'phone-b',
          token: 'token-b',
          apiVersion: 'v19.0',
          apiBaseUrl: 'https://graph.other.com',
        }),
      ),
    ]);

    const [callA, callB] = http.post.mock.calls;
    expect(callA[0]).toBe('https://graph.example.com/v21.0/phone-a/messages');
    expect(callA[2].headers.Authorization).toBe('Bearer token-a');
    expect(callB[0]).toBe('https://graph.other.com/v19.0/phone-b/messages');
    expect(callB[2].headers.Authorization).toBe('Bearer token-b');
  });

  it('does not touch process-wide axios defaults', async () => {
    const http = buildHttp();
    http.post.mockReturnValue(of({ data: { messages: [{ id: 'wamid-1' }] } }));
    const client = new WhatsAppClient(http as never, logger);
    const before = JSON.stringify(http.axiosRef.defaults);

    await client.send(payload, transmission());

    expect(JSON.stringify(http.axiosRef.defaults)).toBe(before);
    expect(http.axiosRef.defaults.baseURL).toBeUndefined();
  });

  it('retries transport/server faults with backoff and then succeeds', async () => {
    jest.useFakeTimers();
    const http = buildHttp();
    http.post
      .mockReturnValueOnce(throwError(() => axiosError(503)))
      .mockReturnValueOnce(throwError(() => networkError()))
      .mockReturnValueOnce(of({ data: { messages: [{ id: 'wamid-1' }] } }));
    const client = new WhatsAppClient(http as never, logger);

    const pending = client.send(payload, transmission());
    await jest.advanceTimersByTimeAsync(60_000);

    await expect(pending).resolves.toEqual({ messages: [{ id: 'wamid-1' }] });
    expect(http.post).toHaveBeenCalledTimes(3);
  });

  it('gives up after the bounded retries when the server keeps failing', async () => {
    jest.useFakeTimers();
    const http = buildHttp();
    http.post.mockReturnValue(throwError(() => axiosError(500)));
    const client = new WhatsAppClient(http as never, logger);

    const pending = client.send(payload, transmission());
    const assertion = expect(pending).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(60_000);

    await assertion;
    expect(http.post).toHaveBeenCalledTimes(4);
  });

  it('does not retry an authorization fault', async () => {
    const http = buildHttp();
    http.post.mockReturnValue(
      throwError(() =>
        axiosError(401, {
          error: { type: 'OAuthException', code: 190, message: 'expired' },
        }),
      ),
    );
    const client = new WhatsAppClient(http as never, logger);

    await expect(client.send(payload, transmission())).rejects.toThrow();
    expect(http.post).toHaveBeenCalledTimes(1);
  });
});

describe('WhatsAppClient.downloadMedia (T3 streaming + limits)', () => {
  let storageDir: string;

  const metadataResponse = (
    overrides: Partial<{
      url: string;
      mime_type: string;
      file_size: number | undefined;
    }> = {},
  ) => ({
    data: {
      id: 'media-1',
      url: 'https://lookaside.example.com/media-1',
      mime_type: 'audio/ogg',
      file_size: 3,
      ...overrides,
    },
  });

  const streamResponse = (chunks: Buffer[], headers: Record<string, string> = {}) =>
    of({ data: Readable.from(chunks), headers });

  beforeEach(() => {
    storageDir = mkdtempSync(join(tmpdir(), 'wa-media-'));
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('downloads through the transmission version/base URL into per-company storage', async () => {
    const http = buildHttp();
    http.get
      .mockReturnValueOnce(of(metadataResponse()))
      .mockReturnValueOnce(streamResponse([Buffer.from('abc')], { 'content-length': '3' }));
    const client = new WhatsAppClient(http as never, logger);

    const result = await client.downloadMedia(transmission(), 'media-1', {
      ext: 'ogg',
      storageDir,
    });

    const [metadataUrl, metadataConfig] = http.get.mock.calls[0];
    expect(metadataUrl).toBe('https://graph.example.com/v21.0/media-1');
    expect(metadataConfig.headers).toEqual({ Authorization: 'Bearer token-a' });
    expect(metadataConfig.timeout).toEqual(expect.any(Number));

    const [streamUrl, streamConfig] = http.get.mock.calls[1];
    expect(streamUrl).toBe('https://lookaside.example.com/media-1');
    expect(streamConfig.headers).toEqual({ Authorization: 'Bearer token-a' });
    expect(streamConfig.responseType).toBe('stream');
    expect(streamConfig.timeout).toEqual(expect.any(Number));

    const filePath = join(storageDir, 'co-1', 'media-1.ogg');
    expect(readFileSync(filePath, 'utf8')).toBe('abc');
    expect(result).toEqual({
      fileUrl: '/uploads/co-1/media-1.ogg',
      mimeType: 'audio/ogg',
      sizeBytes: 3,
    });
  });

  it('rejects media that declares more than the size limit without downloading it', async () => {
    const http = buildHttp();
    http.get.mockReturnValueOnce(
      of(metadataResponse({ mime_type: 'video/mp4', file_size: 10 })),
    );
    const client = new WhatsAppClient(http as never, logger);

    await expect(
      client.downloadMedia(transmission(), 'media-1', {
        maxBytes: 5,
        storageDir,
      }),
    ).rejects.toThrow(/limit/i);

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(existsSync(join(storageDir, 'co-1'))).toBe(false);
  });

  it('aborts a stream that grows past the limit and leaves no partial file', async () => {
    const http = buildHttp();
    http.get
      .mockReturnValueOnce(of(metadataResponse({ file_size: undefined })))
      .mockReturnValueOnce(streamResponse([Buffer.alloc(8, 1), Buffer.alloc(8, 2)]));
    const client = new WhatsAppClient(http as never, logger);

    await expect(
      client.downloadMedia(transmission(), 'media-1', {
        maxBytes: 5,
        storageDir,
      }),
    ).rejects.toThrow(/limit/i);

    expect(existsSync(join(storageDir, 'co-1', 'media-1.ogg'))).toBe(false);
  });

  it('retries a transport fault on the media metadata with backoff', async () => {
    jest.useFakeTimers();
    const http = buildHttp();
    http.get
      .mockReturnValueOnce(throwError(() => axiosError(503)))
      .mockReturnValueOnce(of(metadataResponse()))
      .mockReturnValueOnce(streamResponse([Buffer.from('abc')]));
    const client = new WhatsAppClient(http as never, logger);

    const pending = client.downloadMedia(transmission(), 'media-1', {
      ext: 'ogg',
      storageDir,
    });
    await jest.advanceTimersByTimeAsync(60_000);

    await expect(pending).resolves.toMatchObject({
      fileUrl: '/uploads/co-1/media-1.ogg',
    });
    expect(http.get).toHaveBeenCalledTimes(3);
  });
});
