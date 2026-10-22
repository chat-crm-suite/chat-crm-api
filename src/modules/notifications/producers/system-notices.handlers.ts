// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, IsNull } from 'typeorm';

import { ChannelStatusChangedEvent } from '@common/events/channel-status-changed.event';
import { IaStatusChangedEvent } from '../../analytics/events/analytics.events';
import { Company } from '../../company/entities/company.entity';
import { NotificationDispatcher } from '../notification.dispatcher';

const HOUR_MS = 60 * 60_000;
/** A flapping channel or IA notifies at most once per this window. */
const hourBucket = (at: Date | number = Date.now()) => Math.floor(new Date(at).getTime() / HOUR_MS);

/**
 * Channel health for admins: it went down (`error`, critical, stays on
 * screen) or came back (`active` after an error). One notice per channel,
 * reason and hour, however many times the provider repeats the failure.
 */
@EventsHandler(ChannelStatusChangedEvent)
export class ChannelDownNoticeHandler implements IEventHandler<ChannelStatusChangedEvent> {
  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChannelDownNoticeHandler.name);
  }

  async handle({ companyId, payload, previousStatus }: ChannelStatusChangedEvent): Promise<void> {
    const { channelId, name, status, statusReason, at } = payload;
    const down = status === 'error';
    const recovered = status === 'active' && previousStatus === 'error';
    if (!down && !recovered) return;

    try {
      await this.dispatcher.notify({
        companyId,
        type: 'channel_down',
        audience: { roles: ['admin'] },
        severity: down ? 'critical' : 'success',
        title: down ? `${name} dejó de funcionar` : `${name} volvió a funcionar`,
        body: down
          ? (statusReason ?? 'El proveedor rechazó la conexión. Revisa las credenciales del canal.')
          : 'Los mensajes vuelven a enviarse y recibirse con normalidad.',
        data: { channelId },
        dedupeKey: `channel:${channelId}:${status}:${statusReason ?? ''}:${hourBucket(at)}`,
        groupKey: `channel:${channelId}:${status}`,
      });
    } catch (error) {
      this.logger.warn({ channelId, error: String(error) }, 'Channel notice failed');
    }
  }
}

/**
 * The IA circuit breaker opened (service down, not an admin switching it
 * off): admins of every live company hear it once per hour.
 */
@EventsHandler(IaStatusChangedEvent)
export class IaDownNoticeHandler implements IEventHandler<IaStatusChangedEvent> {
  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IaDownNoticeHandler.name);
  }

  async handle({ status }: IaStatusChangedEvent): Promise<void> {
    if (status.status !== 'unavailable') return;

    try {
      const companies = await this.dataSource.getRepository(Company).find({
        where: { deletedAt: IsNull() },
        select: { id: true },
      });
      const bucket = hourBucket();

      for (const company of companies) {
        await this.dispatcher.notify({
          companyId: company.id,
          type: 'ia_down',
          audience: { roles: ['admin'] },
          title: 'El análisis de IA no está disponible',
          body: 'Los mensajes se siguen recibiendo; el sentimiento se analizará cuando vuelva.',
          dedupeKey: `ia:down:${bucket}`,
          groupKey: 'ia',
        });
      }
    } catch (error) {
      this.logger.warn({ error: String(error) }, 'IA notice failed');
    }
  }
}
