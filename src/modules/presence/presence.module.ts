// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PresenceInterval } from './entities/presence-interval.entity';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

/** Agent presence (socket-driven online time + manual available/away). */
@Module({
  imports: [TypeOrmModule.forFeature([PresenceInterval])],
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
