// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import sentimentConfig from '@config/sentiment.config';
import { Message } from '../../message/entities/message.entity';
import { Analysis } from '../entities/analysis.entity';
import { SentimentResult } from '../entities/sentiment-result.entity';
import { IaModule } from '../ia/ia.module';
import { AnalyseMessageHandler } from './commands/handlers/analyse-message.handler';
import { SentimentClient } from './sentiment.client';
import { SENTIMENT_QUEUE } from './sentiment.constants';
import { SentimentMetricsController } from './sentiment-metrics.controller';
import { SentimentMetricsService } from './sentiment-metrics.service';
import { SentimentProcessor } from './sentiment.processor';
import { SentimentRepository } from './sentiment.repository';
import { SentimentRetryProcessor } from './sentiment-retry.processor';
import { SentimentRetryService } from './sentiment-retry.service';
import { SentimentService } from './sentiment.service';
import { SENTIMENT_RETRY_QUEUE } from './sentiment-retry.policy';

@Module({
  imports: [
    ConfigModule.forFeature(sentimentConfig),
    TypeOrmModule.forFeature([Analysis, SentimentResult, Message]),
    BullModule.registerQueue(
      {
        name: SENTIMENT_QUEUE,
      },
      {
        name: SENTIMENT_RETRY_QUEUE,
      },
    ),
    HttpModule,
    IaModule,
  ],
  controllers: [SentimentMetricsController],
  providers: [
    SentimentClient,
    SentimentService,
    SentimentMetricsService,
    SentimentProcessor,
    SentimentRepository,
    SentimentRetryService,
    SentimentRetryProcessor,
    AnalyseMessageHandler,
  ],
  exports: [SentimentService],
})
export class SentimentModule {}
