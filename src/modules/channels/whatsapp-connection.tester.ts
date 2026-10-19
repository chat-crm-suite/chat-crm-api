// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createHmac, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';

import {
  CONNECTION_CHECK,
  DEFAULT_WHATSAPP_API_VERSION,
  WHATSAPP_GRAPH_BASE_URL,
  WHATSAPP_WEBHOOK_PATH,
  type ConnectionCheck,
  type WhatsAppConnectionTest,
  type WhatsAppCredentials,
} from '../../contracts/index';
import { MetaCredentialsProbe } from '../setup/meta-credentials.probe';
import type { Channel } from './entities/channel.entity';

/** Same reason as the probe: never let a stored value pick the Graph host. */
const GRAPH_BASE_URL = WHATSAPP_GRAPH_BASE_URL;
const TIMEOUT_MS = 8_000;
/** The challenge is 32 hex chars; anything much longer is not our API. */
const MAX_BODY_CHARS = 1_024;

const ok = (message: string): ConnectionCheck => ({
  status: CONNECTION_CHECK.ok,
  message,
});
const failed = (message: string): ConnectionCheck => ({
  status: CONNECTION_CHECK.failed,
  message,
});
const skipped = (message: string): ConnectionCheck => ({
  status: CONNECTION_CHECK.skipped,
  message,
});

const networkError = (error: unknown) =>
  error instanceof Error ? error.message : 'error de red';

/**
 * Settings "Test" button: checks the stored WhatsApp channel end to end,
 * read-only on Meta's side.
 * - sending: phone number ID + access token (+ App Secret) with one Graph read;
 * - webhook: calls the stored webhook URL the way Meta does when the URL is
 *   verified, so a dead ngrok tunnel or a wrong domain shows up here;
 * - subscription: the Meta app receives the WhatsApp Business Account events.
 */
@Injectable()
export class WhatsAppConnectionTester {
  constructor(private readonly probe: MetaCredentialsProbe) {}

  async test(
    channel: Channel,
    credentials: WhatsAppCredentials,
  ): Promise<WhatsAppConnectionTest> {
    const settings = (channel.settings ?? {}) as {
      apiVersion?: string;
      webhookUrl?: string;
    };
    const apiVersion = settings.apiVersion ?? DEFAULT_WHATSAPP_API_VERSION;

    const [sending, webhook, subscription] = await Promise.all([
      this.checkSending(channel, credentials, apiVersion),
      this.checkWebhook(settings.webhookUrl, channel.webhookVerifyToken),
      this.checkSubscription(credentials, apiVersion),
    ]);

    return {
      ok:
        sending.status === CONNECTION_CHECK.ok &&
        webhook.status === CONNECTION_CHECK.ok &&
        subscription.status !== CONNECTION_CHECK.failed,
      sending,
      webhook,
      subscription,
    };
  }

  private async checkSending(
    channel: Channel,
    credentials: WhatsAppCredentials,
    apiVersion: string,
  ): Promise<WhatsAppConnectionTest['sending']> {
    if (!channel.externalAccountId || !credentials.accessToken) {
      return skipped(
        'Falta el Phone Number ID o el access token: guárdalos para poder enviar mensajes.',
      );
    }

    const result = await this.probe.probe({
      phoneNumberId: channel.externalAccountId,
      accessToken: credentials.accessToken,
      appSecret: credentials.appSecret,
      apiVersion,
    });
    if (result.kind === 'ok') {
      return {
        ...ok(
          `Envío listo: Meta acepta el token${result.displayPhoneNumber ? ` para ${result.displayPhoneNumber}` : ''}.`,
        ),
        displayPhoneNumber: result.displayPhoneNumber,
        verifiedName: result.verifiedName,
      };
    }
    if (result.kind === 'unreachable') {
      return failed(`Meta no responde (${result.reason}). Inténtalo de nuevo.`);
    }
    return failed(result.errors.map((error) => error.message).join(' '));
  }

  private async checkWebhook(
    webhookUrl: string | undefined,
    verifyToken: string | undefined,
  ): Promise<WhatsAppConnectionTest['webhook']> {
    if (!webhookUrl) {
      return skipped(
        'No hay webhook URL guardada: guarda el dominio público (p. ej. tu URL de ngrok).',
      );
    }
    if (!verifyToken) {
      return { ...failed('El canal no tiene verify token.'), url: webhookUrl };
    }

    let url: URL;
    try {
      url = new URL(webhookUrl);
    } catch {
      return { ...failed('La webhook URL no es una URL válida.'), url: webhookUrl };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ...failed('La webhook URL debe empezar por https://.'), url: webhookUrl };
    }

    const challenge = randomBytes(16).toString('hex');
    url.searchParams.set('hub.mode', 'subscribe');
    url.searchParams.set('hub.verify_token', verifyToken);
    url.searchParams.set('hub.challenge', challenge);

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return {
        ...failed(
          `La webhook URL no responde (${networkError(error)}). Revisa que el dominio o el túnel de ngrok estén activos.`,
        ),
        url: webhookUrl,
      };
    }

    if (response.status === 403) {
      return {
        ...failed(
          'La webhook URL rechazó el verify token: apunta a otro servidor o a otra instalación.',
        ),
        url: webhookUrl,
      };
    }
    const body = response.ok
      ? (await response.text().catch(() => '')).slice(0, MAX_BODY_CHARS).trim()
      : '';
    if (!response.ok || body !== challenge) {
      return {
        ...failed(
          `La webhook URL respondió ${response.status} sin el challenge de Meta: revisa que termine en /${WHATSAPP_WEBHOOK_PATH} y apunte a este API.`,
        ),
        url: webhookUrl,
      };
    }
    return { ...ok('Webhook listo: la URL responde a la verificación de Meta.'), url: webhookUrl };
  }

  private async checkSubscription(
    credentials: WhatsAppCredentials,
    apiVersion: string,
  ): Promise<ConnectionCheck> {
    if (!credentials.businessId || !credentials.accessToken) {
      return skipped(
        'Falta el Business Account ID o el access token: no se puede comprobar la suscripción en Meta.',
      );
    }

    const params = new URLSearchParams();
    if (credentials.appSecret) {
      params.set(
        'appsecret_proof',
        createHmac('sha256', credentials.appSecret)
          .update(credentials.accessToken)
          .digest('hex'),
      );
    }
    const query = params.size ? `?${params.toString()}` : '';
    const url = `${GRAPH_BASE_URL}/${apiVersion}/${encodeURIComponent(credentials.businessId)}/subscribed_apps${query}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return failed(`Meta no responde (${networkError(error)}). Inténtalo de nuevo.`);
    }

    const body = (await response.json().catch(() => null)) as {
      data?: unknown[];
      error?: { message?: string };
    } | null;
    if (!response.ok || !body || body.error) {
      return failed(
        `Meta no deja leer la suscripción de la cuenta${body?.error?.message ? `: ${body.error.message}` : '.'} Revisa el Business Account ID y los permisos del token.`,
      );
    }
    if (!body.data?.length) {
      return failed(
        'La app de Meta no está suscrita a la cuenta de WhatsApp Business: no llegarán mensajes. Suscríbela (POST /{waba-id}/subscribed_apps) o vuelve a configurar el webhook en Meta.',
      );
    }
    return ok('Suscripción lista: la app de Meta recibe los eventos de la cuenta.');
  }
}
