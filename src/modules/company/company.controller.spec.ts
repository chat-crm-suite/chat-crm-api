// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { IS_USER_SCOPED_KEY } from '../../auth/decorators/access.decorators';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { CompanyController } from './company.controller';
import type { CompanyService } from './company.service';
import type { ServiceSettingsService } from './service-settings/service-settings.service';

const handlers = Object.getOwnPropertyNames(CompanyController.prototype).filter(
  (name) => name !== 'constructor',
);

const handlerOf = (name: string) =>
  Reflect.getOwnPropertyDescriptor(CompanyController.prototype, name)?.value as () => unknown;

const routeOf = (name: string) => {
  const handler = handlerOf(name);
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;

  return `${RequestMethod[method]} ${Reflect.getMetadata(PATH_METADATA, handler) as string}`;
};

describe('CompanyController', () => {
  const reflector = new Reflector();
  const rolesOf = (name: string) =>
    reflector.get<string[] | undefined>(ROLES_KEY, handlerOf(name));
  const nameOf = (route: string) => handlers.find((name) => routeOf(name) === route)!;

  it('only serves the active company: create, list, read-by-id and delete are gone', () => {
    expect(handlers.map(routeOf).sort()).toEqual([
      'GET me',
      'GET me/assignment-settings',
      'GET service-settings',
      'PATCH me',
      'PATCH me/assignment-settings',
      'PUT service-settings',
    ]);
  });

  it('no longer lets a bare session reach any route (no @UserScoped left)', () => {
    expect(reflector.get(IS_USER_SCOPED_KEY, CompanyController)).toBeUndefined();
    for (const name of handlers) {
      expect(reflector.get(IS_USER_SCOPED_KEY, handlerOf(name))).toBeUndefined();
    }
  });

  it('lets only an admin edit the company data (PATCH me)', () => {
    expect(rolesOf(nameOf('PATCH me'))).toEqual(['admin']);
  });

  it('lets admins and supervisors change the assignment settings, while anyone reads them', () => {
    expect(rolesOf(nameOf('PATCH me/assignment-settings'))).toEqual(['admin', 'supervisor']);
    expect(rolesOf(nameOf('GET me/assignment-settings'))).toBeUndefined();
    expect(rolesOf(nameOf('GET me'))).toBeUndefined();
  });

  it('keeps service-settings writes admin-only', () => {
    expect(rolesOf(nameOf('PUT service-settings'))).toEqual(['admin']);
  });

  it('delegates to the service', async () => {
    const service = {
      profile: jest.fn().mockResolvedValue({ id: 'c1' }),
      updateProfile: jest.fn().mockResolvedValue({ id: 'c1', name: 'New' }),
      getAssignmentSettings: jest.fn().mockResolvedValue({ autoAssignEnabled: true }),
      updateAssignmentSettings: jest.fn().mockResolvedValue({ autoAssignEnabled: false }),
    };
    const controller = new CompanyController(
      service as unknown as CompanyService,
      {} as ServiceSettingsService,
    );

    await expect(controller.me()).resolves.toEqual({ id: 'c1' });
    await controller.updateMe({ name: 'New' });
    await controller.assignmentSettings();
    await controller.updateAssignmentSettings({ autoAssignEnabled: false });

    expect(service.updateProfile).toHaveBeenCalledWith({ name: 'New' });
    expect(service.updateAssignmentSettings).toHaveBeenCalledWith({ autoAssignEnabled: false });
  });
});
