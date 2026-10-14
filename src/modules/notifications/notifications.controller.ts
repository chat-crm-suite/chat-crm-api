// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { BadRequestException, Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';

import { NotificationPreferencesSchema } from '../../contracts/index';
import {
  CLS_COMPANY_ID,
  CLS_MEMBER_ID,
  CLS_USER_ID,
} from '../../config/cls.keys';
import { NotificationsService } from './notifications.service';

export class NotificationPreferencesDto extends createZodDto(
  NotificationPreferencesSchema,
) {}

@Controller('/notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationsService,
    private readonly cls: ClsService,
  ) {}

  /** Campanita: últimas 5-20 notificaciones de la empresa activa. */
  @Get()
  getLatest(@Query('limit') limit?: string) {
    const { userId, companyId } = this.context();
    const parsed = limit ? Number(limit) : undefined;
    const safeLimit =
      parsed && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;

    return this.notificationService.listForUser(userId, companyId, safeLimit);
  }

  /** Marca todas las notificaciones pendientes del member como leídas. */
  @Post('/read')
  markAllAsRead() {
    const { userId, companyId } = this.context();

    return this.notificationService.markAllReadForUser(userId, companyId);
  }

  /** Types the current member muted (never stored nor emitted for them). */
  @Get('preferences')
  @ApiOperation({ summary: 'My notification preferences in the active company' })
  @ZodSerializerDto(NotificationPreferencesSchema)
  @ApiOkResponse({ type: NotificationPreferencesDto })
  getPreferences() {
    return this.notificationService.getPreferences(this.memberId());
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Replace my notification preferences in the active company' })
  @ZodSerializerDto(NotificationPreferencesSchema)
  @ApiOkResponse({ type: NotificationPreferencesDto })
  setPreferences(@Body() dto: NotificationPreferencesDto) {
    return this.notificationService.setPreferences(this.memberId(), dto);
  }

  private memberId(): string {
    const memberId = this.cls.get<string>(CLS_MEMBER_ID);
    if (!memberId) throw new BadRequestException('Company context required');

    return memberId;
  }

  private context() {
    const userId = this.cls.get<string>(CLS_USER_ID);
    const companyId = this.cls.get<string>(CLS_COMPANY_ID);
    if (!userId || !companyId) {
      throw new BadRequestException('User and company context required');
    }

    return { userId, companyId };
  }
}
