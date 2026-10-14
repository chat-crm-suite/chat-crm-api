// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { WorkspaceSocketEvent } from '@contracts';
import {
  companyRoom,
  ConversationGateway,
} from '../../conversations/gateways/conversation.gateway';
import { CompanyUpdatedEvent } from '../events/company-updated.event';

/** Announces a profile change to the `company:{id}` room (ids only, clients refetch). */
@EventsHandler(CompanyUpdatedEvent)
export class CompanyUpdatedHandler implements IEventHandler<CompanyUpdatedEvent> {
  constructor(private readonly gateway: ConversationGateway) {}

  handle({ companyId }: CompanyUpdatedEvent): void {
    this.gateway.server
      ?.to(companyRoom(companyId))
      .emit(WorkspaceSocketEvent.CompanyUpdated, { companyId });
  }
}
