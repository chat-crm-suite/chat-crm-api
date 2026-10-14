// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { WorkspaceChangedEvent } from '@common/events/workspace-changed.event';
import { companyRoom, ConversationGateway } from '../gateways/conversation.gateway';

/**
 * Relays table invalidation pings (`team:changed`, `customers:changed`) to the
 * `company:{id}` room of the `conversation` namespace. The payload only names
 * the company and, when known, the affected ids: clients refetch.
 */
@EventsHandler(WorkspaceChangedEvent)
export class WorkspaceChangedHandler implements IEventHandler<WorkspaceChangedEvent> {
  constructor(private readonly gateway: ConversationGateway) {}

  handle({ companyId, event, ids }: WorkspaceChangedEvent): void {
    this.gateway.server
      ?.to(companyRoom(companyId))
      .emit(event, { companyId, ...(ids?.length ? { ids } : {}) });
  }
}
