// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { ChannelStatusChangedEvent } from '@common/events/channel-status-changed.event';
import { ChannelSocketEvent } from '@contracts';
import { companyRoom, ConversationGateway } from '../gateways/conversation.gateway';

/**
 * Relays a channel going down or coming back to the `company:{id}` room, so
 * every open inbox locks or unlocks its composer without a refetch.
 */
@EventsHandler(ChannelStatusChangedEvent)
export class ChannelStatusChangedHandler
  implements IEventHandler<ChannelStatusChangedEvent>
{
  constructor(private readonly gateway: ConversationGateway) {}

  handle({ companyId, payload }: ChannelStatusChangedEvent): void {
    this.gateway.server
      ?.to(companyRoom(companyId))
      .emit(ChannelSocketEvent.StatusChanged, payload);
  }
}
