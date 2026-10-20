// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { DataSource } from 'typeorm';

import { AnalyticsSocketEvent } from '@contracts';
import type { ConversationGateway } from '../../conversations/gateways/conversation.gateway';
import type { AnalyticsCacheService } from '../cache/analytics-cache.service';
import { AnalyticsEventsService } from './analytics-events.service';

describe('AnalyticsEventsService IA status', () => {
  it('reaches sockets through company rooms, never a namespace-wide broadcast', async () => {
    const roomEmit = jest.fn();
    const server = { emit: jest.fn(), to: jest.fn(() => ({ emit: roomEmit })) };
    const dataSource = {
      getRepository: () => ({ find: jest.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]) }),
    };
    const events = new AnalyticsEventsService(
      { server } as unknown as ConversationGateway,
      {} as AnalyticsCacheService,
      dataSource as unknown as DataSource,
    );

    await events.emitIaStatus({ enabled: true } as never);

    expect(server.emit).not.toHaveBeenCalled();
    expect(server.to).toHaveBeenCalledWith(['company:c1', 'company:c2']);
    expect(roomEmit).toHaveBeenCalledWith(AnalyticsSocketEvent.IaStatusChanged, { enabled: true });
    events.onModuleDestroy();
  });
});
