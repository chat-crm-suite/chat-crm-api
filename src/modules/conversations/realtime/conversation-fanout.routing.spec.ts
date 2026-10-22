// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { PinoLogger } from 'nestjs-pino';

import { ConversationSocketEvent, type ConversationListItem } from '@contracts';
import type { ConversationGateway } from '../gateways/conversation.gateway';
import type { ConversationAccessService } from './conversation-access.service';
import { ConversationFanoutService } from './conversation-fanout.service';

/** Queue and lifecycle pings reach role rooms, never the bare company room. */
describe('ConversationFanoutService routing', () => {
  const emits: Array<{ rooms: string[]; event: string }> = [];
  const gateway = {
    server: {
      to: (target: string | string[]) => ({
        emit: (event: string) => emits.push({ rooms: [target].flat(), event }),
      }),
    },
  } as unknown as ConversationGateway;
  const access = { getActiveAssignee: jest.fn() };
  const fanout = new ConversationFanoutService(
    gateway,
    access as unknown as ConversationAccessService,
    { setContext: jest.fn(), warn: jest.fn() } as unknown as PinoLogger,
  );
  const staff = ['company:c1:role:admin', 'company:c1:role:supervisor'];

  beforeEach(() => {
    emits.length = 0;
    access.getActiveAssignee.mockReset();
  });

  it('created + assigned: staff and the assignee only', () => {
    fanout.emitCreated('c1', { assignee: { userId: 'u1' } } as ConversationListItem);

    expect(emits).toEqual([{ rooms: [...staff, 'user:u1'], event: ConversationSocketEvent.Created }]);
  });

  it('created + unassigned: staff and every agent (they may claim it)', () => {
    fanout.emitCreated('c1', { assignee: null } as ConversationListItem);

    expect(emits[0].rooms).toEqual([...staff, 'company:c1:role:agent']);
  });

  it('unassigned: staff and agents', () => {
    fanout.emitUnassigned('c1', 'conv-1');

    expect(emits).toEqual([
      { rooms: [...staff, 'company:c1:role:agent'], event: ConversationSocketEvent.ConversationUnassigned },
    ]);
  });

  it('status change: thread, staff and the current assignee', async () => {
    access.getActiveAssignee.mockResolvedValue({ memberId: 'm1', userId: 'u1' });

    await fanout.emitStatusChanged('c1', {
      conversationId: 'conv-1',
      status: 'closed',
      previousStatus: 'open',
      byMemberId: 'm1',
      at: new Date(),
    });

    expect(emits[0].rooms).toEqual([...staff, 'user:u1', 'conversation:conv-1']);
    expect(emits.flatMap((emit) => emit.rooms)).not.toContain('company:c1');
  });

  it('status change never throws when the assignee lookup fails', async () => {
    access.getActiveAssignee.mockRejectedValue(new Error('db down'));

    await expect(
      fanout.emitStatusChanged('c1', {
        conversationId: 'conv-1',
        status: 'closed',
        previousStatus: 'open',
        byMemberId: null,
        at: new Date(),
      }),
    ).resolves.toBeUndefined();
  });
});
