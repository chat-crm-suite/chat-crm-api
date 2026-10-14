// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { PinoLogger } from 'nestjs-pino';
import type { DataSource } from 'typeorm';

import { ConversationSocketEvent, NOTIFICATION_TYPES } from '@contracts';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { ConversationGateway } from '../gateways/conversation.gateway';
import {
  ASSIGNED_NOTIFICATION_TYPE,
  ConversationAssignmentNotifier,
  UNASSIGNED_NOTIFICATION_TYPE,
} from './conversation-assignment.notifier';

describe('ConversationAssignmentNotifier muting', () => {
  const emit = jest.fn<void, [string, unknown]>();
  const notifications = { create: jest.fn(), hasUnread: jest.fn() };
  const gateway = {
    server: { to: jest.fn(() => ({ emit })) },
    revokeConversationAccess: jest.fn(),
  };
  const member = { id: 'member-1', userId: 'user-1', companyId: 'company-1' };
  const dataSource = {
    getRepository: jest.fn(() => ({
      findOne: jest.fn().mockResolvedValue({ ...member, autoAssignNotifySupervisors: true }),
      find: jest.fn().mockResolvedValue([member]),
    })),
  };
  const notifier = new ConversationAssignmentNotifier(
    notifications as unknown as NotificationsService,
    gateway as unknown as ConversationGateway,
    dataSource as unknown as DataSource,
    { setContext: jest.fn(), warn: jest.fn() } as unknown as PinoLogger,
  );

  const newNotificationEvents = () =>
    emit.mock.calls.filter(([event]) => event === ConversationSocketEvent.NewNotification);

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.hasUnread.mockResolvedValue(false);
  });

  it('uses the shared notification type constants', () => {
    expect(NOTIFICATION_TYPES).toContain(ASSIGNED_NOTIFICATION_TYPE);
    expect(NOTIFICATION_TYPES).toContain(UNASSIGNED_NOTIFICATION_TYPE);
    expect(ASSIGNED_NOTIFICATION_TYPE).toBe('conversation_assigned');
    expect(UNASSIGNED_NOTIFICATION_TYPE).toBe('queue_unassigned');
  });

  it('emits the bell notification when the assignment type is delivered', async () => {
    notifications.create.mockResolvedValue({
      id: 'n1',
      title: 'Nuevo chat asignado',
      createdAt: new Date(),
    });

    await notifier.notifyAssigned('conv-1', 'member-1');

    expect(newNotificationEvents()).toHaveLength(1);
  });

  it('emits no bell notification when the member muted the assignment type, but still the assignment', async () => {
    notifications.create.mockResolvedValue(null);

    await notifier.notifyAssigned('conv-1', 'member-1');

    expect(newNotificationEvents()).toHaveLength(0);
    expect(emit).toHaveBeenCalledWith(ConversationSocketEvent.ConversationAssigned, {
      conversationId: 'conv-1',
      memberId: 'member-1',
    });
  });

  it('emits nothing for a supervisor who muted the unassigned-queue type', async () => {
    notifications.create.mockResolvedValue(null);

    await notifier.notifyUnassigned('conv-1', 'company-1');

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'queue_unassigned', recipientMemberId: 'member-1' }),
    );
    expect(newNotificationEvents()).toHaveLength(0);
  });
});
