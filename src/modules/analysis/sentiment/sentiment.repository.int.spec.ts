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

import { getTestSQLiteConfig } from '@helpers/test-database.helper';
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

  it('marks a skipped analysis with its reason and no sentiment detail', async () => {
    const { conversation, message } = await seedConversation();
    const analysis = await repository.createProcessing({
      companyId: conversation.companyId,
      messageId: message.id,
      conversationId: conversation.id,
      model: 'pysentiment',
    });

    await repository.markSkipped(analysis.id, 'ia_unavailable');

    const stored = await dataSource
      .getRepository(Analysis)
      .findOneByOrFail({ id: analysis.id });
    expect(stored.status).toBe('skipped');
    expect(stored.skipReason).toBe('ia_unavailable');
    expect(stored.completedAt).toBeNull();
    await expect(
      dataSource
        .getRepository(SentimentResult)
        .countBy({ analysisId: analysis.id }),
    ).resolves.toBe(0);
  });
});

/**
 * T4: the deferred-retry schedule lives on the same analysis row. `markSkipped`
 * sets the wait before the next attempt from the persisted `retryCount`
 * (5m → 24h), or clears it for manual skips and once the 8-attempt cap is hit.
 */
describe('SentimentRepository deferred retry scheduling (T4)', () => {
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

  const seedAnalysis = async (
    overrides: Partial<Analysis> = {},
  ): Promise<Analysis> => {
    const conversation = await ConversationFactory.transient({
      manager: dataSource.manager,
    }).create();
    const message = await MessageFactory.transient({
      manager: dataSource.manager,
    }).create({
      conversationId: conversation.id,
      companyId: conversation.companyId,
    });

    return AnalysisFactory.transient({ manager: dataSource.manager }).create({
      conversationId: conversation.id,
      companyId: conversation.companyId,
      messageId: message.id,
      status: 'skipped',
      skipReason: 'ia_unavailable',
      ...overrides,
    });
  };

  const stored = (id: string): Promise<Analysis> =>
    dataSource.getRepository(Analysis).findOneByOrFail({ id });

  /** nextRetryAt must be `delayMs` in the future (small clock slack). */
  const expectScheduledIn = (
    value: Date | null | undefined,
    delayMs: number,
  ): void => {
    expect(value).toBeInstanceOf(Date);
    const diff = (value as Date).getTime() - Date.now();
    expect(diff).toBeGreaterThan(delayMs - 10_000);
    expect(diff).toBeLessThanOrEqual(delayMs + 10_000);
  };

  it('schedules the first attempt 5 minutes out on an unavailability skip', async () => {
    const analysis = await seedAnalysis();

    await repository.markSkipped(analysis.id, 'ia_unavailable');

    const row = await stored(analysis.id);
    expect(row.retryCount).toBe(0);
    expectScheduledIn(row.nextRetryAt, 300_000);
  });

  it('walks the backoff schedule from the persisted attempt count', async () => {
    const second = await seedAnalysis({ retryCount: 1 });
    const last = await seedAnalysis({ retryCount: 7 });

    await repository.markSkipped(second.id, 'circuit_breaker');
    await repository.markSkipped(last.id, 'ia_unavailable');

    expectScheduledIn((await stored(second.id)).nextRetryAt, 900_000);
    expectScheduledIn((await stored(last.id)).nextRetryAt, 86_400_000);
  });

  it('never schedules a manual skip', async () => {
    const analysis = await seedAnalysis();

    await repository.markSkipped(analysis.id, 'kill_switch');

    const row = await stored(analysis.id);
    expect(row.skipReason).toBe('kill_switch');
    expect(row.nextRetryAt).toBeNull();
  });

  it('gives up after the 8th attempt instead of scheduling a 9th', async () => {
    const analysis = await seedAnalysis({ retryCount: 8 });

    await repository.markSkipped(analysis.id, 'ia_unavailable');

    const row = await stored(analysis.id);
    expect(row.retryCount).toBe(8);
    expect(row.nextRetryAt).toBeNull();
  });

  it('finds only due retryable sentiment skips, oldest first', async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    const dueFirst = await seedAnalysis({
      skipReason: 'ia_unavailable',
      nextRetryAt: past,
    });
    const dueSecond = await seedAnalysis({
      skipReason: 'circuit_breaker',
      nextRetryAt: new Date(past.getTime() + 1_000),
    });
    await seedAnalysis({ nextRetryAt: future });
    await seedAnalysis({ skipReason: 'kill_switch', nextRetryAt: null });
    await seedAnalysis({ status: 'failed', nextRetryAt: past });
    await seedAnalysis({ status: 'completed', nextRetryAt: past });
    await seedAnalysis({ retryCount: 8, nextRetryAt: past });
    await seedAnalysis({ type: 'intent', nextRetryAt: past });

    const found = await repository.findDueRetries(100, new Date());

    expect(found.map((analysis) => analysis.id)).toEqual([
      dueFirst.id,
      dueSecond.id,
    ]);
  });

  // T6: `/metrics` reports the retry backlog as recovery debt — every skipped
  // retryable sentiment analysis still scheduled, overdue or not, excluding
  // manual skips, hard failures and rows that exhausted the 8 attempts.
  it('counts the pending retry backlog for metrics', async () => {
    // The suite shares one sqlite database across tests, so assert the delta.
    const before = await repository.countPendingRetries();
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    await seedAnalysis({ skipReason: 'ia_unavailable', nextRetryAt: past });
    await seedAnalysis({ skipReason: 'circuit_breaker', nextRetryAt: future });
    await seedAnalysis({ skipReason: 'kill_switch', nextRetryAt: null });
    await seedAnalysis({ status: 'failed', nextRetryAt: past });
    await seedAnalysis({ status: 'completed', nextRetryAt: past });
    await seedAnalysis({ retryCount: 8, nextRetryAt: past });
    await seedAnalysis({ type: 'intent', nextRetryAt: past });
    await seedAnalysis({ nextRetryAt: null });

    await expect(repository.countPendingRetries()).resolves.toBe(before + 2);
  });

  it('caps the batch', async () => {
    const past = new Date(Date.now() - 60_000);
    await seedAnalysis({ nextRetryAt: past });
    await seedAnalysis({ nextRetryAt: past });
    await seedAnalysis({ nextRetryAt: past });

    await expect(
      repository.findDueRetries(2, new Date()),
    ).resolves.toHaveLength(2);
  });

  it('moves a due row to its next attempt and never double-schedules', async () => {
    const analysis = await seedAnalysis({ retryCount: 0 });
    const next = new Date(Date.now() + 900_000);

    await expect(
      repository.scheduleRetryAttempt(analysis.id, 0, next),
    ).resolves.toBe(true);

    let row = await stored(analysis.id);
    expect(row.retryCount).toBe(1);
    expect(
      Math.abs((row.nextRetryAt as Date).getTime() - next.getTime()),
    ).toBeLessThan(1_000);

    await expect(
      repository.scheduleRetryAttempt(analysis.id, 0, next),
    ).resolves.toBe(false);
    row = await stored(analysis.id);
    expect(row.retryCount).toBe(1);
  });

  it('clears the schedule at the cap and refuses rows that moved on', async () => {
    const analysis = await seedAnalysis({ retryCount: 7 });

    await expect(
      repository.scheduleRetryAttempt(analysis.id, 7, null),
    ).resolves.toBe(true);
    expect((await stored(analysis.id)).nextRetryAt).toBeNull();

    const completed = await seedAnalysis({ status: 'completed' });
    await expect(
      repository.scheduleRetryAttempt(completed.id, 0, new Date()),
    ).resolves.toBe(false);
  });

  it('flips a skipped row back to processing exactly once', async () => {
    const analysis = await seedAnalysis({ retryCount: 1 });

    const started = await repository.startRetry(analysis.id);

    expect(started).toMatchObject({
      id: analysis.id,
      status: 'processing',
      skipReason: null,
      retryCount: 1,
    });
    await expect(repository.startRetry(analysis.id)).resolves.toBeNull();
  });

  it('does not start a retry for a row that is not skipped', async () => {
    const completed = await seedAnalysis({ status: 'completed' });

    await expect(repository.startRetry(completed.id)).resolves.toBeNull();
  });
});
