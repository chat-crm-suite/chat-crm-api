// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { UserSessionsRevokedEvent } from '@auth/session/user-sessions-revoked.event';
import { ConversationGateway } from '../gateways/conversation.gateway';

/**
 * A socket keeps the company rooms it joined at connect time, so when the
 * user's memberships change its live sockets are dropped right away; the
 * client reconnects (after refreshing its session) with the new claims.
 */
@EventsHandler(UserSessionsRevokedEvent)
export class UserSessionsRevokedHandler
  implements IEventHandler<UserSessionsRevokedEvent>
{
  constructor(private readonly gateway: ConversationGateway) {}

  handle(event: UserSessionsRevokedEvent): void {
    this.gateway.disconnectUser(event.userId);
  }
}
