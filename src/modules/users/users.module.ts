// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { AvatarStorageService } from './avatar-storage.service';
import { UserRepository } from './user.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, CompanyMember]),
  ],
  controllers: [UsersController],
  providers: [UsersService, UserRepository, AvatarStorageService],
  exports: [UsersService]
})
export class UsersModule { }
