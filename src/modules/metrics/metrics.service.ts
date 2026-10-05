import { Injectable } from '@nestjs/common';
import { MetricsRepository } from './metrics.repository';
import { MetricMapper } from './metrics.mapper';
import { CompareMetric, SentimentActor, SentimentType } from './metrics.types';
import { SentimentRepository } from './repositories/sentiment.repository';
import { SentimentTopQuery } from './metrics.interface';
import { COMPARE_PERIOD_CONFIG } from './constants/metrics.constants';
import { PeriodTime } from '../../lib/period';

export interface TopAgentMetrics {
  agentId: string;
  agentName: string;
  totalPositive: number;
  averagePositiveScore: number;
  weightedScore: number;
}

@Injectable()
export class MetricsService {
  constructor(
    private readonly repo: MetricsRepository,
    private readonly sentiment: SentimentRepository,
  ) {}

  private sentimentTopMap: Record<
    SentimentActor,
    (type: SentimentType, limit: number) => Promise<SentimentTopQuery[]>
  > = {
    agent: (type, limit) => this.sentiment.topAgent(type, limit),
    client: (type, limit) => this.sentiment.topClient(type, limit),
  };

  async getSentimentTop(
    actor: SentimentActor,
    type: SentimentType,
    limit: number = 5,
  ) {
    const handler = this.sentimentTopMap[actor];
    const queries = await handler(type, limit);

    return MetricMapper.sentimentTop(queries, actor);
  }

  async getComparePeriod(metric: CompareMetric, period: PeriodTime) {
    const { target, column, where, timeColumn } =
      COMPARE_PERIOD_CONFIG[metric];
    const { current, previous } = await this.repo.comparePeriod(
      { target, column, period, timeColumn },
      where,
    );

    return MetricMapper.compare(metric, [current, previous]);
  }

  async getTrendPeriod(period: PeriodTime) {
    return this.sentiment.trendPeriod(period);
  }

  async getTopContacts() {
    return this.repo.getTopContacts();
  }

  // private fillMissingData(
  //   data: { date: string; pos: number; neg: number; neu: number }[],
  //   start: Date,
  //   end: Date,
  //   stepFn: (date: Date) => Date,
  //   formatStr: string
  // ) {
  //   const filled: typeof data = [];
  //   let current = start;

  //   while (current <= end) {
  //     const formatted = format(current, formatStr);
  //     const existing = data.find((r) => r.date === formatted);
  //     if (existing) {
  //       filled.push(existing);
  //     } else {
  //       filled.push({ date: formatted, pos: 0, neg: 0, neu: 0 });
  //     }
  //     current = stepFn(current);
  //   }

  //   return filled;
  // }

  async getAgentsFast(label: SentimentType, limit: number = 5) {
    const queries = await this.repo.getAgentsFast(label, limit);
    return MetricMapper.toAgentMetrics(queries);
  }

  async getBestClients(userId: string) {
    const queries = await this.repo.getBestClients(userId);

    return MetricMapper.toBestClients(queries);
  }
}
