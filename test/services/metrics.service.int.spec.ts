import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { subDays, subMonths } from 'date-fns';
import { DataSource, EntityTarget } from 'typeorm';

import * as Entities from '@entities';
import {
  AnalysisFactory,
  CompanyFactory,
  CompanyMemberFactory,
  MessageFactory,
  SentimentResultFactory,
} from '@factories';
import { MetricsRepository } from '@modules/metrics/metrics.repository';
import { MetricsService } from '@modules/metrics/metrics.service';
import { SentimentRepository } from '@modules/metrics/repositories/sentiment.repository';
import type { SentimentType } from '@modules/metrics/metrics.types';
import { getTestConfig, truncateAllTables } from '../helpers/test-database.helper';

const entities = Object.values(Entities) as EntityTarget<unknown>[];

jest.setTimeout(120_000);

/** `sentiment_results.label` stores the analysis contract label (long form). */
const STORED_LABEL: Record<
  SentimentType,
  'positive' | 'neutral' | 'negative'
> = {
  POS: 'positive',
  NEU: 'neutral',
  NEG: 'negative',
};

describe('Metrics Service - integration', () => {
  let module: TestingModule;
  let service: MetricsService;
  let dataSource: DataSource;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot(getTestConfig(entities))],
      providers: [MetricsService, MetricsRepository, SentimentRepository],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
    dataSource = module.get<DataSource>(getDataSourceToken());
  }, 30000);

  beforeEach(async () => {
    // The raw-SQL repository runs on the pool, not on a test transaction, so
    // each case starts from a clean schema.
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
    if (module) await module.close();
  });

  async function setupAgentsAndMessages(
    dates: Array<{ date: Date; agentNum: 1 | 2 }>,
    label: SentimentType,
    scorePositive: number,
    scoreNeutral: number,
    scoreNegative: number,
  ) {
    const manager = dataSource.manager;
    const company = await CompanyFactory.transient({ manager }).create();

    const [agent1, agent2] = await Promise.all([
      CompanyMemberFactory.transient({ manager }).create({
        companyId: company.id,
      }),
      CompanyMemberFactory.transient({ manager }).create({
        companyId: company.id,
      }),
    ]);

    await Promise.all(
      dates.map(async ({ date, agentNum }) => {
        const member = agentNum === 1 ? agent1 : agent2;

        const message = await MessageFactory.transient({ manager }).create({
          companyId: company.id,
          senderType: 'member',
          senderMemberId: member.id,
          direction: 'outbound',
          createdAt: date,
        });

        const analysis = await AnalysisFactory.transient({ manager }).create({
          companyId: company.id,
          conversationId: message.conversationId,
          message: { id: message.id },
          type: 'sentiment',
          label: STORED_LABEL[label],
        });

        await SentimentResultFactory.transient({ manager }).create({
          analysisId: analysis.id,
          label: STORED_LABEL[label],
          scorePositive,
          scoreNeutral,
          scoreNegative,
        });
      }),
    );

    return { agent1, agent2 };
  }

  describe.each<{
    label: SentimentType;
    scorePositive: number;
    scoreNeutral: number;
    scoreNegative: number;
  }>([
    {
      label: 'POS',
      scorePositive: 0.9,
      scoreNeutral: 0.05,
      scoreNegative: 0.05,
    },
    {
      label: 'NEU',
      scorePositive: 0.2,
      scoreNeutral: 0.7,
      scoreNegative: 0.1,
    },
    {
      label: 'NEG',
      scorePositive: 0.1,
      scoreNeutral: 0.2,
      scoreNegative: 0.7,
    },
  ])('with label $label', ({ label, scorePositive, scoreNeutral, scoreNegative }) => {
    it.each([
      {
        scenario: 'last 7 days',
        dates: [
          { date: subDays(new Date(), 2), agentNum: 1 as const },
          { date: subDays(new Date(), 4), agentNum: 1 as const },
          { date: subDays(new Date(), 6), agentNum: 2 as const },
        ],
        expectedAgent: 1,
        expectedTotal: 2,
      },
      {
        scenario: 'last 30 days',
        dates: [
          { date: subDays(new Date(), 5), agentNum: 1 as const },
          { date: subDays(new Date(), 10), agentNum: 1 as const },
          { date: subDays(new Date(), 15), agentNum: 2 as const },
          { date: subDays(new Date(), 25), agentNum: 1 as const },
        ],
        expectedAgent: 1,
        expectedTotal: 3,
      },
      {
        scenario: 'last 3 months',
        dates: [
          { date: subMonths(new Date(), 1), agentNum: 1 as const },
          { date: subMonths(new Date(), 2), agentNum: 2 as const },
          { date: subMonths(new Date(), 2), agentNum: 2 as const },
          { date: subMonths(new Date(), 3), agentNum: 2 as const },
        ],
        expectedAgent: 2,
        expectedTotal: 3,
      },
      {
        scenario: 'last 6 months',
        dates: [
          { date: subMonths(new Date(), 1), agentNum: 1 as const },
          { date: subMonths(new Date(), 2), agentNum: 1 as const },
          { date: subMonths(new Date(), 3), agentNum: 1 as const },
          { date: subMonths(new Date(), 4), agentNum: 2 as const },
          { date: subMonths(new Date(), 5), agentNum: 2 as const },
        ],
        expectedAgent: 1,
        expectedTotal: 3,
      },
    ])(
      'should return top agents for $scenario',
      async ({ dates, expectedAgent, expectedTotal }) => {
        const { agent1, agent2 } = await setupAgentsAndMessages(
          dates,
          label,
          scorePositive,
          scoreNeutral,
          scoreNegative,
        );

        const result = await service.getSentimentTop('agent', label);
        const expected = expectedAgent === 1 ? agent1 : agent2;

        expect(result.length).toBeGreaterThan(0);
        expect(result[0].agent?.username).toBe(expected.user.username);
        expect(result[0].total).toBe(expectedTotal);
        expect(result[0].label).toBe(label);
      },
    );
  });
});
