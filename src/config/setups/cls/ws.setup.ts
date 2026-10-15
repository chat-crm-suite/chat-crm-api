// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ClsService } from 'nestjs-cls';
import { ExecutionContext } from '@nestjs/common';
import { Socket } from 'socket.io';

import type { JwtPayload } from '@auth/auth.types';
import { CLS_USER_ID } from '../../cls.keys';

/**
 * Socket events only expose the user verified in the handshake
 * (`client.data.user`). A socket spans every company of the user, so there is
 * no company in the CLS here: handlers resolve it per event against the
 * token memberships. Handshake headers are never trusted.
 */
export function setupWsContext(cls: ClsService, context: ExecutionContext) {
  const client = context.switchToWs().getClient<Socket>();
  const user = (client.data as { user?: JwtPayload } | undefined)?.user;

  cls.set(CLS_USER_ID, user?.sub);
}
