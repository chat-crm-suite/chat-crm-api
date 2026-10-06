// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import sentimentConfig from '../../../config/sentiment.config';
import { Message } from '../../message/entities/message.entity';
import { Analysis } from '../entities/analysis.entity';
import { SentimentResult } from '../entities/sentiment-result.entity';
import { AnalyseMessageHandler } from './commands/handlers/analyse-message.handler';
import { SentimentClient } from './sentiment.client';
import { SENTIMENT_QUEUE } from './sentiment.constants';
import { SentimentProcessor } from './sentiment.processor';
import { SentimentRepository } from './sentiment.repository';
import { SentimentService } from './sentiment.service';

@Module({
  imports: [
    ConfigModule.forFeature(sentimentConfig),
    TypeOrmModule.forFeature([Analysis, SentimentResult, Message]),
    BullModule.registerQueue({
      name: SENTIMENT_QUEUE,
    }),
    HttpModule,
  ],
  providers: [
    SentimentClient,
    SentimentService,
    SentimentProcessor,
    SentimentRepository,
    AnalyseMessageHandler,
  ],
  exports: [SentimentService],
})
export class SentimentModule {}
