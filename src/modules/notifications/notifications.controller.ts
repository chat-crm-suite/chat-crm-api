import { BadRequestException, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ClsService } from 'nestjs-cls';

import { CLS_COMPANY_ID, CLS_USER_ID } from '../../config/cls.keys';
import { NotificationsService } from './notifications.service';

@Controller('/notifications')
@UseGuards(AuthGuard('jwt'))
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

  private context() {
    const userId = this.cls.get<string>(CLS_USER_ID);
    const companyId = this.cls.get<string>(CLS_COMPANY_ID);
    if (!userId || !companyId) {
      throw new BadRequestException('User and company context required');
    }

    return { userId, companyId };
  }
}
