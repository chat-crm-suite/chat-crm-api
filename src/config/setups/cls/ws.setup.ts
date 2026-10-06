// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ClsService } from 'nestjs-cls';
import { ExecutionContext } from '@nestjs/common';
import { Socket } from 'socket.io';

export function setupWsContext(cls: ClsService, context: ExecutionContext) {
  const client: Socket = context.switchToWs().getClient<Socket>();

  const companyId = client.handshake.headers['x-company-id'] as string;
  const userId = client.handshake.headers['x-user-id'] as string;

  cls.set('company.id', companyId);
  cls.set('user.id', userId);
}
