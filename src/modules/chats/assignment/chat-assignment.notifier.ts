import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, In } from 'typeorm';
import { Company } from '../../company/entities/company.entity';
import { Member } from '../../member/member.entity';
import { MemberRole, MemberStatus } from '../../member/member.types';
import { NotificationsService } from '../../notifications/notifications.service';
import { ChatGatewayEvent } from '../chat.enum';
import { Chat } from '../entities/index';
import { ChatGateway } from '../gateways/chat.gateway';

export const ASSIGNED_NOTIFICATION_TITLE = 'Nuevo chat asignado';
export const UNASSIGNED_NOTIFICATION_TITLE = 'Chat sin asignar';

/**
 * Avisos de asignación (Q12).
 *
 * - Persiste una notificación por usuario (campanita) y emite `new-notification`
 *   por socket al room personal `user:{id}` (evento que el front ya escucha).
 * - Los avisos de cola a supervisores se deduplican por notificación no leída:
 *   un aviso vigente por supervisor, no uno por chat.
 * - Nunca lanza: un fallo de aviso no puede romper el flujo de mensajes.
 */
@Injectable()
export class ChatAssignmentNotifier {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly gateway: ChatGateway,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChatAssignmentNotifier.name);
  }

  /** El agente recibió un chat: notificación persistente + eventos socket. */
  async notifyAssigned(chatId: string, agentId: string, notifyAgent = true) {
    try {
      const payload = notifyAgent
        ? await this.createNotification(
            ASSIGNED_NOTIFICATION_TITLE,
            'Tenés un chat nuevo esperando respuesta',
            agentId,
          )
        : { chatId, agentId };

      this.emitToUser(agentId, {
        event: ChatGatewayEvent.ChatAssigned,
        payload: { chatId, agentId },
      });

      if (notifyAgent && 'id' in payload) {
        this.emitToUser(agentId, {
          event: ChatGatewayEvent.NewNotification,
          payload,
        });
      }
    } catch (error) {
      this.logger.warn(
        { chatId, agentId, error: String(error) },
        'Assignment notification failed',
      );
    }
  }

  /** Un chat quedó sin asignar: aviso a admin/manager de la empresa. */
  async notifyUnassigned(chatId: string, companyId?: string) {
    try {
      const company = companyId
        ? await this.dataSource.getRepository(Company).findOne({ where: { id: companyId } })
        : await this.resolveCompanyByChat(chatId);
      if (!company?.autoAssignNotifySupervisors) return;

      const supervisors = await this.dataSource.getRepository(Member).find({
        where: {
          company: { id: company.id },
          status: MemberStatus.ACTIVE,
          role: In([MemberRole.ADMIN, MemberRole.MANAGER]),
        },
        relations: ['user'],
      });

      for (const supervisor of supervisors) {
        const userId = supervisor.user?.id;
        if (!userId) continue;

        const alreadyNotified = await this.notifications.hasUnreadByTitle(
          userId,
          UNASSIGNED_NOTIFICATION_TITLE,
        );
        if (alreadyNotified) continue;

        const payload = await this.createNotification(
          UNASSIGNED_NOTIFICATION_TITLE,
          'Hay un chat esperando agente en la cola',
          userId,
        );
        this.emitToUser(userId, {
          event: ChatGatewayEvent.NewNotification,
          payload,
        });
      }

      this.gateway.server
        ?.to(`company:${company.id}`)
        .emit(ChatGatewayEvent.ChatUnassigned, { chatId });
    } catch (error) {
      this.logger.warn(
        { chatId, companyId, error: String(error) },
        'Unassigned notification failed',
      );
    }
  }

  private async resolveCompanyByChat(chatId: string): Promise<Company | null> {
    const chat = await this.dataSource.getRepository(Chat).findOne({
      where: { id: chatId },
      relations: ['client', 'client.company'],
    });
    return chat?.client?.company ?? null;
  }

  private async createNotification(title: string, message: string, userId: string) {
    const notification = await this.notifications.create(title, message, userId);
    return {
      id: notification.id,
      title: notification.title,
      message: notification.message,
      read: notification.read,
      time: notification.createdAt,
    };
  }

  private emitToUser(
    userId: string,
    { event, payload }: { event: ChatGatewayEvent; payload: unknown },
  ) {
    this.gateway.server?.to(`user:${userId}`).emit(event, payload);
  }
}
