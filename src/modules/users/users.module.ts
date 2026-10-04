import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CsvModule } from 'nest-csv-parser';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { Chat } from '../chats/entities/index';
import { UserRepository } from './user.repository';
import { UserSubscriber } from './user.subscriber';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Chat]),
    CsvModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, UserRepository, UserSubscriber],
  exports: [UsersService]
})
export class UsersModule { }
