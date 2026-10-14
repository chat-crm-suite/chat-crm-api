// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import type {
  NotificationPreferences,
  NotificationType,
} from '../../contracts/index';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { Notification } from './entities/notification.entity';

/** Bell list bounds: at least 5, never more than 20. */
const MIN_LIMIT = 5;
const MAX_LIMIT = 20;

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(CompanyMember)
    private readonly memberRepo: Repository<CompanyMember>,
  ) {}

  /**
   * Stores one notification. Returns `null` (nothing stored, so nothing for
   * the caller to emit) when the recipient muted this type.
   */
  async create(params: {
    companyId: string;
    recipientMemberId: string;
    type: NotificationType;
    title: string;
    body?: string;
    data?: Record<string, unknown>;
  }): Promise<Notification | null> {
    if (await this.isMuted(params.recipientMemberId, params.type)) return null;

    const notification = this.notificationRepo.create({
      companyId: params.companyId,
      recipientMemberId: params.recipientMemberId,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      data: params.data ?? null,
    });

    return await this.notificationRepo.save(notification);
  }

  /**
   * ¿El member ya tiene una notificación NO leída de este tipo?
   * Se usa para no repetir avisos de cola sin asignar (dedupe por estado).
   */
  async hasUnread(recipientMemberId: string, type: NotificationType): Promise<boolean> {
    const count = await this.notificationRepo.count({
      where: { recipientMemberId, type, readAt: IsNull() },
    });

    return count > 0;
  }

  /** Últimas notificaciones del member detrás de (userId, companyId). */
  async listForUser(
    userId: string,
    companyId: string,
    limit = MIN_LIMIT,
  ): Promise<Notification[]> {
    const member = await this.resolveMember(userId, companyId);
    if (!member) return [];

    return await this.notificationRepo.find({
      where: { recipientMemberId: member.id, companyId },
      order: { createdAt: 'DESC' },
      take: this.clampLimit(limit),
    });
  }

  /** Marca como leídas todas las notificaciones pendientes del member. */
  async markAllReadForUser(
    userId: string,
    companyId: string,
  ): Promise<{ updated: number }> {
    const member = await this.resolveMember(userId, companyId);
    if (!member) return { updated: 0 };

    const result = await this.notificationRepo.update(
      { recipientMemberId: member.id, companyId, readAt: IsNull() },
      { readAt: new Date() },
    );

    return { updated: result.affected ?? 0 };
  }

  /** Preferences of a member; nothing muted until they choose. */
  async getPreferences(memberId: string): Promise<NotificationPreferences> {
    const member = await this.memberRepo.findOne({
      where: { id: memberId },
      select: { id: true, notificationPrefs: true },
    });

    return { muted: member?.notificationPrefs?.muted ?? [] };
  }

  async setPreferences(
    memberId: string,
    preferences: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    const muted = [...new Set(preferences.muted)];
    await this.memberRepo.update(memberId, { notificationPrefs: { muted } });

    return { muted };
  }

  /** One indexed lookup per notification; no cache on purpose. */
  private async isMuted(
    memberId: string,
    type: NotificationType,
  ): Promise<boolean> {
    const { muted } = await this.getPreferences(memberId);

    return muted.includes(type);
  }

  private resolveMember(userId: string, companyId: string) {
    return this.memberRepo.findOne({ where: { userId, companyId } });
  }

  private clampLimit(limit: number): number {
    if (!Number.isFinite(limit)) return MIN_LIMIT;
    return Math.min(Math.max(limit, MIN_LIMIT), MAX_LIMIT);
  }
}
