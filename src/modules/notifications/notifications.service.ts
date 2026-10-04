import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ClsService } from "nestjs-cls";
import { In, Repository } from "typeorm";
import { Notification } from "./entities/notification.entity";

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    private readonly cls: ClsService,
  ) { }

  async create(title: string, message?: string, userId?: string) {
    const notification = this.notificationRepo.create({
      title,
      message,
      ...(userId ? { user: { id: userId } } : {}),
    });
    return await this.notificationRepo.save(notification);
  }

  /**
   * ¿El usuario ya tiene una notificación NO leída de este título?
   * Se usa para no repetir avisos de cola sin asignar (throttle por estado).
   */
  async hasUnreadByTitle(userId: string, title: string): Promise<boolean> {
    const count = await this.notificationRepo.count({
      where: { user: { id: userId }, title, read: false },
    });
    return count > 0;
  }

  async getAll() {
    const userId = this.cls.get<string>('user.id');
    return await this.notificationRepo.find({
      where: userId ? { user: { id: userId } } : {},
      order: { createdAt: 'DESC', read: 'ASC' },
      take: 5,
    });
  }

  async markAsRead(ids: string[]) {
    return await this.notificationRepo.update({ id: In(ids) }, { read: true });
  }
}
