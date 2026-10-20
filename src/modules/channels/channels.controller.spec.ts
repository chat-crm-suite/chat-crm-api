// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { ChannelsController } from './channels.controller';

/**
 * Role gates of the channels routes (enforced by the global `RolesGuard`):
 * credentials are admin-only; the inbox still reads the sanitized channels
 * and may re-run the connection test ("Reintentar verificación").
 */
describe('ChannelsController roles', () => {
  const reflector = new Reflector();
  const rolesOf = (method: keyof ChannelsController) => {
    const handler = Object.getOwnPropertyDescriptor(
      ChannelsController.prototype,
      method,
    )?.value as () => unknown;
    return reflector.get<string[] | undefined>(ROLES_KEY, handler);
  };

  it('limits every credential read or write to admins', () => {
    expect(rolesOf('getWhatsAppConfig')).toEqual(['admin']);
    expect(rolesOf('update')).toEqual(['admin']);
    expect(rolesOf('create')).toEqual(['admin']);
  });

  it('keeps the sanitized reads and the connection test open to members', () => {
    expect(rolesOf('list')).toBeUndefined();
    expect(rolesOf('validateConfig')).toBeUndefined();
    expect(rolesOf('test')).toBeUndefined();
  });
});
