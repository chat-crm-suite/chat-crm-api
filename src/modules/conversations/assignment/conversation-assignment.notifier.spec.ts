// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { PinoLogger } from 'nestjs-pino';
import type { DataSource } from 'typeorm';

import { ConversationSocketEvent, NOTIFICATION_TYPES } from '@contracts';
import type { NotificationDispatcher } from '../../notifications/notification.dispatcher';
import type { ConversationGateway } from '../gateways/conversation.gateway';
import type { ConversationFanoutService } from '../realtime/conversation-fanout.service';
import {
  ASSIGNED_NOTIFICATION_TYPE,
  ConversationAssignmentNotifier,
  QUEUE_GROUP_KEY,
  UNASSIGNED_NOTIFICATION_TYPE,
} from './conversation-assignment.notifier';

describe('ConversationAssignmentNotifier', () => {
  const emit = jest.fn<void, [string, unknown]>();
  const dispatcher = { notify: jest.fn() };
  const fanout = { emitUnassigned: jest.fn() };
  const gateway = {
    server: { to: jest.fn(() => ({ emit })) },
    revokeConversationAccess: jest.fn(),
  };
  const member = { id: 'member-1', userId: 'user-1', companyId: 'company-1' };
  let notifySupervisors = true;
  const dataSource = {
    getRepository: jest.fn(() => ({
      findOne: jest.fn().mockImplementation(() =>
        Promise.resolve({
          ...member,
          autoAssignNotifySupervisors: notifySupervisors,
          customer: { displayName: 'Ana' },
        }),
      ),
    })),
  };
  const notifier = new ConversationAssignmentNotifier(
    dispatcher as unknown as NotificationDispatcher,
    gateway as unknown as ConversationGateway,
    fanout as unknown as ConversationFanoutService,
    dataSource as unknown as DataSource,
    { setContext: jest.fn(), warn: jest.fn() } as unknown as PinoLogger,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    notifySupervisors = true;
  });

  it('uses the shared notification type constants', () => {
    expect(NOTIFICATION_TYPES).toContain(ASSIGNED_NOTIFICATION_TYPE);
    expect(NOTIFICATION_TYPES).toContain(UNASSIGNED_NOTIFICATION_TYPE);
  });

  it('assignment: a silent data event to the assignee plus one dispatched notice', async () => {
    await notifier.notifyAssigned('conv-1', 'member-1');

    expect(gateway.server.to).toHaveBeenCalledWith('user:user-1');
    expect(emit).toHaveBeenCalledWith(ConversationSocketEvent.ConversationAssigned, {
      conversationId: 'conv-1',
      memberId: 'member-1',
    });
    // The toast comes from the notification only: never emitted here directly.
    expect(emit).not.toHaveBeenCalledWith(ConversationSocketEvent.NewNotification, expect.anything());
    expect(dispatcher.notify).toHaveBeenCalledTimes(1);
    expect(dispatcher.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        type: 'conversation_assigned',
        audience: { memberIds: ['member-1'] },
        body: 'Ana espera tu respuesta',
        data: { conversationId: 'conv-1' },
      }),
    );
    const [[sent]] = dispatcher.notify.mock.calls as [[{ dedupeKey: string }]];
    expect(sent.dedupeKey).toMatch(/^assigned:conv-1:/);
  });

  it('self-claim and self-assignment refresh lists but notify nobody', async () => {
    await notifier.notifyAssigned('conv-1', 'member-1', { notify: false });
    await notifier.notifyAssigned('conv-1', 'member-1', { actorMemberId: 'member-1' });

    expect(emit).toHaveBeenCalledTimes(2);
    expect(dispatcher.notify).not.toHaveBeenCalled();
  });

  it('queue: list refresh for staff and agents, grouped notice for admin/supervisor minus the actor', async () => {
    await notifier.notifyUnassigned('conv-1', 'company-1', { actorMemberId: 'member-9' });

    expect(fanout.emitUnassigned).toHaveBeenCalledWith('company-1', 'conv-1');
    expect(dispatcher.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'queue_unassigned',
        audience: { roles: ['admin', 'supervisor'] },
        groupKey: QUEUE_GROUP_KEY,
        excludeMemberIds: ['member-9'],
      }),
    );
  });

  it('queue: no notice when the company turned supervisor alerts off', async () => {
    notifySupervisors = false;

    await notifier.notifyUnassigned('conv-1', 'company-1');

    expect(fanout.emitUnassigned).toHaveBeenCalled();
    expect(dispatcher.notify).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    dispatcher.notify.mockRejectedValueOnce(new Error('boom'));

    await expect(notifier.notifyAssigned('conv-1', 'member-1')).resolves.toBeUndefined();
  });
});
