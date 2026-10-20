// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';

import {
  NotificationListQuerySchema,
  NotificationListResponseSchema,
  NotificationMarkReadSchema,
  NotificationPreferencesSchema,
  NotificationUnreadCountSchema,
} from '../../contracts/index';
import {
  CLS_COMPANY_ID,
  CLS_MEMBER_ID,
  CLS_USER_ID,
} from '../../config/cls.keys';
import { NotificationsService, type NotificationReader } from './notifications.service';

export class NotificationPreferencesDto extends createZodDto(
  NotificationPreferencesSchema,
) {}
export class NotificationListQueryDto extends createZodDto(NotificationListQuerySchema) {}
export class NotificationListResponseDto extends createZodDto(NotificationListResponseSchema) {}
export class NotificationUnreadCountDto extends createZodDto(NotificationUnreadCountSchema) {}
export class NotificationMarkReadDto extends createZodDto(NotificationMarkReadSchema) {}

@Controller('/notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationsService,
    private readonly cls: ClsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My notifications in the active company, latest activity first' })
  @ZodSerializerDto(NotificationListResponseSchema)
  @ApiOkResponse({ type: NotificationListResponseDto })
  list(@Query() query: NotificationListQueryDto) {
    return this.notificationService.list(this.reader(), query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread badge in the active company' })
  @ZodSerializerDto(NotificationUnreadCountSchema)
  @ApiOkResponse({ type: NotificationUnreadCountDto })
  async unreadCount() {
    return { unreadCount: await this.notificationService.unreadCount(this.reader().memberId) };
  }

  @Post('/read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark all my notifications read, or those of one conversation (synced to my other tabs)',
  })
  @ZodSerializerDto(NotificationUnreadCountSchema)
  @ApiOkResponse({ type: NotificationUnreadCountDto })
  markAllAsRead(@Body() scope: NotificationMarkReadDto) {
    return this.notificationService.markAllRead(this.reader(), scope ?? {});
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark one notification read (synced to my other tabs)' })
  @ZodSerializerDto(NotificationUnreadCountSchema)
  @ApiOkResponse({ type: NotificationUnreadCountDto })
  markAsRead(@Param('id') id: string) {
    return this.notificationService.markRead(this.reader(), id);
  }

  /** Muted types are never stored nor emitted; `desktop` types may show an OS notice. */
  @Get('preferences')
  @ApiOperation({ summary: 'My notification preferences in the active company' })
  @ZodSerializerDto(NotificationPreferencesSchema)
  @ApiOkResponse({ type: NotificationPreferencesDto })
  getPreferences() {
    return this.notificationService.getPreferences(this.reader().memberId);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Replace my notification preferences in the active company' })
  @ZodSerializerDto(NotificationPreferencesSchema)
  @ApiOkResponse({ type: NotificationPreferencesDto })
  setPreferences(@Body() dto: NotificationPreferencesDto) {
    return this.notificationService.setPreferences(this.reader().memberId, dto);
  }

  private reader(): NotificationReader {
    const userId = this.cls.get<string>(CLS_USER_ID);
    const companyId = this.cls.get<string>(CLS_COMPANY_ID);
    const memberId = this.cls.get<string>(CLS_MEMBER_ID);
    if (!userId || !companyId || !memberId) {
      throw new BadRequestException('Company context required');
    }

    return { userId, companyId, memberId };
  }
}
