import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom, map } from 'rxjs';
import { AxiosError } from 'axios';
import { PinoLogger } from 'nestjs-pino';
import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { WhatsAppCredentials } from '../../../contracts/index';
import type { ChannelTransmission } from '../../../modules/channels/channels.service';
import type { Channel } from '../../../modules/channels/entities/channel.entity';
import type { WhatsAppPayload } from '../interfaces/whatsapp-message.interface';
import type { WhatsAppErrorResponse } from '../interfaces/whatsapp.interface';

const DEFAULT_API_VERSION = 'v22.0';
const DEFAULT_API_BASE_URL = 'https://graph.facebook.com';
const MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_MEDIA_BYTES = 16 * 1024 * 1024;

export interface WhatsAppSendResponse {
  messaging_product?: 'whatsapp';
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
}

interface WhatsAppMediaMetadata {
  id: string;
  url: string;
  mime_type: string;
  file_size?: number;
}

export interface DownloadedMedia {
  /** Public URL served from the per-company uploads folder. */
  fileUrl: string;
  mimeType: string;
  sizeBytes: number | null;
}

export interface DownloadMediaOptions {
  /** Extension for the stored file (webhook filename); MIME fallback. */
  ext?: string;
  maxBytes?: number;
  timeoutMs?: number;
  /** Storage root; defaults to `uploads/` under the process cwd. */
  storageDir?: string;
}

/** A media file that cannot be stored: retrying would never help. */
export class WhatsAppMediaTooLargeError extends Error {
  constructor(mediaId: string, size: number, maxBytes: number) {
    super(
      `WhatsApp media ${mediaId} is ${size} bytes, over the ${maxBytes} byte limit`,
    );
    this.name = 'WhatsAppMediaTooLargeError';
  }
}

/** How a Graph/transport failure must be handled by the caller. */
export interface WhatsAppErrorInfo {
  /** Authorization fault: retrying only burns quota; surface it immediately. */
  authFault: boolean;
  /** Transport/server fault worth retrying with backoff. */
  retryable: boolean;
  code?: string;
  message: string;
}

/**
 * Stateless WhatsApp Cloud API transport (T3). There is no `setChannel`: each
 * operation receives its transmission, so the Graph version, base URL, token
 * and phone id always come from the channel that owns the work and concurrent
 * companies can never mix credentials. Nothing is written to the shared axios
 * defaults.
 */
@Injectable()
export class WhatsAppClient {
  constructor(
    private readonly http: HttpService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsAppClient.name);
  }

  async send(
    payload: WhatsAppPayload,
    transmission: ChannelTransmission,
  ): Promise<WhatsAppSendResponse> {
    const { channel, credentials } = transmission;
    const url = `${graphBaseUrl(channel)}/${channel.externalAccountId}/messages`;

    this.logger.debug(`Sending ${payload.type} message to ${payload.to}`);

    return this.withRetry(() =>
      firstValueFrom(
        this.http
          .post<WhatsAppSendResponse>(url, payload, {
            headers: authHeaders(credentials),
            timeout: REQUEST_TIMEOUT_MS,
          })
          .pipe(map((res) => res.data)),
      ),
    );
  }

  /**
   * Streams inbound media into per-company local storage. The Graph version
   * and base URL come from the channel; the download is bounded by a size
   * limit (declared and streamed) and a timeout, and transport faults retry
   * with backoff. A failed attempt never leaves a partial file behind.
   */
  downloadMedia(
    transmission: ChannelTransmission,
    mediaId: string,
    options: DownloadMediaOptions = {},
  ): Promise<DownloadedMedia> {
    return this.withRetry(() =>
      this.attemptDownload(transmission, mediaId, options),
    );
  }

  private async attemptDownload(
    transmission: ChannelTransmission,
    mediaId: string,
    options: DownloadMediaOptions,
  ): Promise<DownloadedMedia> {
    const { channel, credentials } = transmission;
    const headers = authHeaders(credentials);
    const timeout = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_MEDIA_BYTES;

    const metadata = await firstValueFrom(
      this.http
        .get<WhatsAppMediaMetadata>(`${graphBaseUrl(channel)}/${mediaId}`, {
          headers,
          timeout,
        })
        .pipe(map((res) => res.data)),
    );

    if (metadata.file_size !== undefined && metadata.file_size > maxBytes) {
      throw new WhatsAppMediaTooLargeError(
        mediaId,
        metadata.file_size,
        maxBytes,
      );
    }

    const response = await firstValueFrom(
      this.http.get<NodeJS.ReadableStream>(metadata.url, {
        headers,
        responseType: 'stream',
        timeout,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
      }),
    );

    const declared = Number(response.headers?.['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new WhatsAppMediaTooLargeError(mediaId, declared, maxBytes);
    }

    const companyDir = sanitizeSegment(channel.companyId);
    const extension = sanitizeExtension(
      options.ext ?? extensionFromMime(metadata.mime_type),
    );
    const fileName = `${sanitizeSegment(mediaId)}.${extension}`;
    const dir = join(
      options.storageDir ?? join(process.cwd(), 'uploads'),
      companyDir,
    );
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, fileName);

    try {
      await pipeline(
        response.data,
        new ByteLimitTransform(mediaId, maxBytes),
        createWriteStream(filePath),
      );
    } catch (error: unknown) {
      await rm(filePath, { force: true }).catch(() => undefined);
      throw error;
    }

    return {
      fileUrl: `/uploads/${companyDir}/${fileName}`,
      mimeType: metadata.mime_type,
      sizeBytes: metadata.file_size ?? statSync(filePath).size,
    };
  }

  /** Bounded retry with exponential backoff for retryable faults only. */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;
        const { retryable } = classifyWhatsAppError(error);

        if (!retryable || attempt === MAX_ATTEMPTS) throw error;

        await sleep(backoffDelayMs(attempt));
      }
    }

    throw lastError;
  }
}

/** `{apiBaseUrl}/{apiVersion}` from the channel settings, never hardcoded. */
export function graphBaseUrl(channel: Channel): string {
  const settings = channel.settings ?? {};
  const apiVersion = (settings.apiVersion as string) ?? DEFAULT_API_VERSION;
  const apiBaseUrl =
    (settings.apiBaseUrl as string) ?? DEFAULT_API_BASE_URL;

  return `${apiBaseUrl}/${apiVersion}`;
}

function authHeaders(credentials: WhatsAppCredentials) {
  return { Authorization: `Bearer ${credentials.accessToken}` };
}

/**
 * Classifies a Graph/transport failure. Authorization faults (HTTP 401/403 or
 * Meta `OAuthException`) are never retryable; transport failures (no response)
 * and server/rate-limit statuses are.
 */
export function classifyWhatsAppError(error: unknown): WhatsAppErrorInfo {
  if (error instanceof WhatsAppMediaTooLargeError) {
    return { authFault: false, retryable: false, message: error.message };
  }

  const axiosError = error as AxiosError<WhatsAppErrorResponse>;
  const status = axiosError?.response?.status;
  const apiError = axiosError?.response?.data?.error;

  // Axios enforces `maxContentLength`/`maxBodyLength` on its own; a file over
  // the limit is terminal, never retryable.
  if (/maxContentLength|maxBodyLength/i.test(axiosError?.message ?? '')) {
    return {
      authFault: false,
      retryable: false,
      message: axiosError.message,
    };
  }

  const code =
    apiError?.code !== undefined
      ? String(apiError.code)
      : status !== undefined
        ? String(status)
        : undefined;

  if (status === 401 || status === 403 || apiError?.type === 'OAuthException') {
    return {
      authFault: true,
      retryable: false,
      code,
      message:
        apiError?.message ??
        axiosError?.message ??
        'WhatsApp authorization failed',
    };
  }

  const retryable = status === undefined ? true : status >= 500 || status === 429;

  return {
    authFault: false,
    retryable,
    code,
    message: apiError?.message ?? axiosError?.message ?? 'WhatsApp request failed',
  };
}

function backoffDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Streams through the file while enforcing the byte limit as bytes arrive. */
class ByteLimitTransform extends Transform {
  private seen = 0;

  constructor(
    private readonly mediaId: string,
    private readonly maxBytes: number,
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.seen += chunk.length;

    if (this.seen > this.maxBytes) {
      callback(
        new WhatsAppMediaTooLargeError(this.mediaId, this.seen, this.maxBytes),
      );
      return;
    }

    callback(null, chunk);
  }
}

/** Keeps filesystem paths to safe characters (company ids, media ids, ext). */
function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function sanitizeExtension(ext?: string): string {
  const clean = (ext ?? '').replace(/[^a-zA-Z0-9]/g, '');
  return clean || 'bin';
}

function extensionFromMime(mime?: string): string {
  const subtype = mime?.split('/')[1]?.split(';')[0]?.trim();

  if (!subtype) return 'bin';
  return subtype === 'jpeg' ? 'jpg' : subtype;
}
