// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, EntityTarget } from 'typeorm';

import * as Entities from '@entities';
import {
  AnalysisFactory,
  ConversationFactory,
  MessageFactory,
  SentimentResultFactory,
} from '@factories';

import { getTestSQLiteConfig } from '../../../../test/helpers/test-database.helper';
import { Message } from '../../message/entities/message.entity';
import { Analysis } from '../entities/analysis.entity';
import { SentimentResult } from '../entities/sentiment-result.entity';
import {
  SentimentRepository,
  type ConversationSentimentAggregate,
} from './sentiment.repository';

// `message_status_events` cannot be synchronized into sqlite (bigint PK), same
// exclusion as the shared sqlite test config.
const entities = Object.values(Entities).filter(
  (entity) => entity.name !== 'MessageStatusEvent',
) as EntityTarget<unknown>[];

/**
 * T4: `GET /conversations/:id/sentiment` reads its aggregate from the
 * persisted `analyses` + `sentiment_results` rows: averages over completed
 * sentiment analyses of that conversation, scoped to the caller's company.
 */
describe('SentimentRepository conversation aggregate (T4)', () => {
  let module: TestingModule;
  let repository: SentimentRepository;
  let dataSource: DataSource;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(getTestSQLiteConfig(entities)),
        TypeOrmModule.forFeature([Analysis, SentimentResult, Message]),
      ],
      providers: [SentimentRepository],
    }).compile();

    repository = module.get(SentimentRepository);
    dataSource = module.get<DataSource>(getDataSourceToken());
  }, 60_000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
    if (module) await module.close();
  });

  const seedConversation = async () => {
    const manager = dataSource.manager;
    const conversation = await ConversationFactory.transient({
      manager,
    }).create();
    const message = await MessageFactory.transient({ manager }).create({
      conversationId: conversation.id,
      companyId: conversation.companyId,
    });

    return { conversation, message };
  };

  const seedAnalysis = async (
    conversationId: string,
    companyId: string,
    messageId: string,
    scores: { pos: number; neu: number; neg: number },
    status: Analysis['status'] = 'completed',
  ) => {
    const manager = dataSource.manager;
    const analysis = await AnalysisFactory.transient({ manager }).create({
      conversationId,
      companyId,
      messageId,
      status,
    });

    return SentimentResultFactory.transient({ manager }).create({
      analysisId: analysis.id,
      scorePositive: scores.pos,
      scoreNeutral: scores.neu,
      scoreNegative: scores.neg,
    });
  };

  const expectAggregate = (
    actual: ConversationSentimentAggregate,
    expected: ConversationSentimentAggregate,
  ) => {
    expect(actual.totalMessages).toBe(expected.totalMessages);
    expect(actual.avgPos).toBeCloseTo(expected.avgPos, 4);
    expect(actual.avgNeu).toBeCloseTo(expected.avgNeu, 4);
    expect(actual.avgNeg).toBeCloseTo(expected.avgNeg, 4);
  };

  it('averages the completed analyses of the conversation', async () => {
    const { conversation, message } = await seedConversation();
    const { companyId } = conversation;

    await seedAnalysis(conversation.id, companyId, message.id, {
      pos: 0.8,
      neu: 0.1,
      neg: 0.1,
    });
    await seedAnalysis(conversation.id, companyId, message.id, {
      pos: 0.6,
      neu: 0.3,
      neg: 0.1,
    });
    await seedAnalysis(conversation.id, companyId, message.id, {
      pos: 0.4,
      neu: 0.4,
      neg: 0.2,
    });

    expectAggregate(
      await repository.aggregateConversationSentiment(
        conversation.id,
        companyId,
      ),
      { avgPos: 0.6, avgNeu: 0.2667, avgNeg: 0.1333, totalMessages: 3 },
    );
  });

  it('ignores the analyses of other conversations', async () => {
    const first = await seedConversation();
    const second = await seedConversation();

    await seedAnalysis(
      first.conversation.id,
      first.conversation.companyId,
      first.message.id,
      { pos: 1, neu: 0, neg: 0 },
    );
    await seedAnalysis(
      first.conversation.id,
      first.conversation.companyId,
      first.message.id,
      { pos: 0.5, neu: 0.5, neg: 0 },
    );
    await seedAnalysis(
      second.conversation.id,
      second.conversation.companyId,
      second.message.id,
      { pos: 0, neu: 0, neg: 1 },
    );

    expectAggregate(
      await repository.aggregateConversationSentiment(
        first.conversation.id,
        first.conversation.companyId,
      ),
      { avgPos: 0.75, avgNeu: 0.25, avgNeg: 0, totalMessages: 2 },
    );
  });

  it('scopes the aggregate to the company', async () => {
    const first = await seedConversation();
    const second = await seedConversation();

    await seedAnalysis(
      first.conversation.id,
      first.conversation.companyId,
      first.message.id,
      { pos: 0.5, neu: 0.5, neg: 0 },
    );
    // Same conversation id, another company: tenant leakage, must be ignored.
    await seedAnalysis(
      first.conversation.id,
      second.conversation.companyId,
      first.message.id,
      { pos: 0, neu: 0, neg: 1 },
    );

    expectAggregate(
      await repository.aggregateConversationSentiment(
        first.conversation.id,
        first.conversation.companyId,
      ),
      { avgPos: 0.5, avgNeu: 0.5, avgNeg: 0, totalMessages: 1 },
    );
  });

  it('ignores analyses that are not completed', async () => {
    const { conversation, message } = await seedConversation();
    const { companyId } = conversation;

    await seedAnalysis(conversation.id, companyId, message.id, {
      pos: 0.9,
      neu: 0.05,
      neg: 0.05,
    });
    await seedAnalysis(
      conversation.id,
      companyId,
      message.id,
      { pos: 0, neu: 0, neg: 1 },
      'processing',
    );

    expectAggregate(
      await repository.aggregateConversationSentiment(
        conversation.id,
        companyId,
      ),
      { avgPos: 0.9, avgNeu: 0.05, avgNeg: 0.05, totalMessages: 1 },
    );
  });

  it('returns zeros when the conversation has no analyses', async () => {
    const { conversation } = await seedConversation();

    expectAggregate(
      await repository.aggregateConversationSentiment(
        conversation.id,
        conversation.companyId,
      ),
      { avgPos: 0, avgNeu: 0, avgNeg: 0, totalMessages: 0 },
    );
  });

  it('detects whether the conversation belongs to the company', async () => {
    const first = await seedConversation();
    const second = await seedConversation();

    await expect(
      repository.conversationBelongsToCompany(
        first.conversation.id,
        first.conversation.companyId,
      ),
    ).resolves.toBe(true);
    await expect(
      repository.conversationBelongsToCompany(
        first.conversation.id,
        second.conversation.companyId,
      ),
    ).resolves.toBe(false);
    await expect(
      repository.conversationBelongsToCompany(
        'unknown-conversation',
        first.conversation.companyId,
      ),
    ).resolves.toBe(false);
  });
});
