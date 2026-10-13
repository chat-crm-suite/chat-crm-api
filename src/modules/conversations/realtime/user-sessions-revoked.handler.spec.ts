// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { UserSessionsRevokedEvent } from '@auth/session/user-sessions-revoked.event';
import type { ConversationGateway } from '../gateways/conversation.gateway';
import { UserSessionsRevokedHandler } from './user-sessions-revoked.handler';

describe('UserSessionsRevokedHandler', () => {
  it('kicks the revoked user sockets so they reconnect with fresh claims', () => {
    const gateway = { disconnectUser: jest.fn() };

    new UserSessionsRevokedHandler(gateway as unknown as ConversationGateway).handle(
      new UserSessionsRevokedEvent('user-1'),
    );

    expect(gateway.disconnectUser).toHaveBeenCalledWith('user-1');
  });
});
