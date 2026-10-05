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
