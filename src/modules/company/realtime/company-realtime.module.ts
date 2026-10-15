// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { ConversationsModule } from '../../conversations/conversations.module';
import { CompanyUpdatedHandler } from './company-updated.handler';

/**
 * Realtime side of the company profile. Kept apart from `CompanyModule` so
 * that module stays free of the conversations stack (sockets, queues) for
 * everything that only needs the company services.
 */
@Module({
  imports: [CqrsModule, ConversationsModule],
  providers: [CompanyUpdatedHandler],
})
export class CompanyRealtimeModule {}
