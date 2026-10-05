import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { Notification } from './entities/notification.entity';
import { NotificationController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, CompanyMember])
  ],
  controllers: [NotificationController],
  providers: [NotificationsService],
  exports: [NotificationsService]
})
export class NotificationsModule { }
