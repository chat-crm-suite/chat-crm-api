// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Analysis } from './entities/analysis.entity';
import { SentimentResult } from './entities/sentiment-result.entity';
import { SentimentModule } from './sentiment/sentiment.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Analysis, SentimentResult]),
    SentimentModule,
  ],
})
export class AnalysisModule {}
