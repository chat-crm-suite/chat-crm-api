import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom, map, retry, switchMap, throwError, timer } from 'rxjs';
import { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { AxiosError } from 'axios';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { CommandBus } from '@nestjs/cqrs';

import type { WhatsAppCredentials } from '../../../contracts/index';
import { Channel } from '../../../modules/channels/entities/channel.entity';
import { FailWhatsAppMessageCommand } from '../../../modules/conversations/commands/fail-whatsapp-message.command';
import { WhatsAppPayload } from '../interfaces/whatsapp-message.interface';
import { WhatsAppErrorResponse } from '../interfaces/whatsapp.interface';

@Injectable()
export class WhatsAppClient {
  private phoneNumberId?: string;

  constructor(
    private readonly http: HttpService,
    private readonly logger: PinoLogger,
    private readonly commandBus: CommandBus,
  ) {
    this.logger.setContext(WhatsAppClient.name);
  }

  setChannel(channel: Channel, credentials: WhatsAppCredentials) {
    const settings = (channel.settings ?? {}) as Record<string, unknown>;
    const apiVersion = (settings.apiVersion as string) ?? 'v22.0';
    const apiBaseUrl =
      (settings.apiBaseUrl as string) ?? 'https://graph.facebook.com';

    this.phoneNumberId = channel.externalAccountId;
    this.http.axiosRef.defaults.baseURL = `${apiBaseUrl}/${apiVersion}`;
    this.http.axiosRef.defaults.headers.common['Authorization'] =
      `Bearer ${credentials.accessToken}`;
    this.http.axiosRef.defaults.headers.common['Content-Type'] =
      'application/json';

    this.logger.debug(`Configured for phoneNumberId=${this.phoneNumberId}`);
  }

  private ensureConfigured() {
    const baseUrl = this.http?.axiosRef?.defaults?.baseURL;

    if (!this.phoneNumberId || !baseUrl) {
      this.logger.error(
        { phone: this.phoneNumberId, baseUrl },
        'WhatsAppClient no configurado. Llama a setChannel() antes de usar.',
      );
      throw new Error(
        'WhatsAppClient not configured. Call setChannel() before using.',
      );
    }
  }

  upload(mediaId: string, token: string, ext?: string) {
    return this.http
      .get<{
        id: string;
        messaging_product: 'whatsapp';
        url: string;
        mime_type: string;
        sha256: string;
        file_size: number;
      }>(`https://graph.facebook.com/v22.0/${mediaId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      .pipe(
        switchMap((res) => {
          const mediaUrl = res.data.url;
          const mimeType = res.data.mime_type;

          // Derivar extensión según MIME
          const extension = ext ?? (mimeType.split('/')[1] || 'bin');

          return this.http
            .get(mediaUrl, {
              responseType: 'arraybuffer',
            })
            .pipe(
              map((fileRes) => {
                const filename = `${mediaId}.${extension}`;
                const filePath = join(process.cwd(), 'uploads', filename);
                const buffer = Buffer.from(fileRes.data);

                writeFileSync(filePath, buffer);

                return {
                  fileUrl: `/uploads/${filename}`,
                  mimeType,
                  size: res.data.file_size,
                };
              }),
            );
        }),
      );
  }

  async send(payload: WhatsAppPayload) {
    this.ensureConfigured();

    const url = `${this.phoneNumberId}/messages`;

    this.logger.debug(`Sending ${payload.type} message to ${payload.to}`);

    const res$ = this.http.post<Response>(url, payload).pipe(
      retry({
        count: 5,
        delay: (err: AxiosError, retryCount) => {
          const errorData = err.response?.data as WhatsAppErrorResponse;

          if (errorData.error?.type === 'OAuthException') {
            this.logger.error(
              `Fatal WhatsApp error (no retry): ${errorData?.error?.message ?? err.message}`,
            );
            void this.commandBus.execute(
              new FailWhatsAppMessageCommand(payload.to, {
                code: errorData.error.code,
                error_data: errorData.error.error_data ?? {
                  details:
                    'Request whatsapp client error for ' +
                    payload.type +
                    ' message',
                },
                message: errorData.error.message,
                title: 'Whatsapp cliente error',
              }),
            );
            return throwError(() => err);
          }

          this.logger.warn(
            `Retry ${retryCount}: WhatsApp error -> ${errorData.error?.message ?? err.message}`,
          );
          return timer(retryCount * 1000);
        },
      }),
      map(({ data }) => data),
    );

    return firstValueFrom(res$).catch((err: AxiosError) => {
      this.logger.error(`Send failed: ${err.message}`);
    });
  }
}
