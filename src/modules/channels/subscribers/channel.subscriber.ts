// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { randomBytes } from 'crypto';
import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
} from 'typeorm';

import { Channel } from '../entities/channel.entity';

/**
 * Every channel gets its webhook verify token on insert, so Meta's webhook
 * handshake can be set up before any credential exists (the `pending` channel
 * each company is born with). A token sent by the caller is kept.
 *
 * Registered through the DataSource `subscribers` option
 * (`src/config/database.config.ts`, `data-source.ts`).
 */
@EventSubscriber()
export class ChannelSubscriber implements EntitySubscriberInterface<Channel> {
  listenTo(): typeof Channel {
    return Channel;
  }

  beforeInsert(event: InsertEvent<Channel>): void {
    if (!event.entity.webhookVerifyToken) {
      event.entity.webhookVerifyToken = randomBytes(32).toString('hex');
    }
  }
}
