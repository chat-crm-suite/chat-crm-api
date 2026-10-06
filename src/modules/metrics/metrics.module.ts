// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { Message } from '../message/entities/message.entity';
import { MetricsRepository } from './metrics.repository';
import { SentimentRepository } from './repositories/sentiment.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message]),
  ],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    MetricsRepository,
    SentimentRepository,
  ],
  exports: [MetricsService],
})
export class MetricsModule { }
