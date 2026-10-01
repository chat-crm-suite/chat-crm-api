import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';

import { getTestSQLiteConfig } from './helpers/test-database.helper';
import { subYears } from 'date-fns';
import { AnalysisFactory, ChatFactory, ContactFactory, MessageFactory, SentimentAnalysisFactory, UserFactory } from '@factories';
import {
  Analysis,
  Chat, Company, Contact,
  Message, SentimentAnalysis, User,
  WhatsAppConfig, Notification
} from '@entities';

describe('Entity Factories Integration Tests', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(getTestSQLiteConfig([
          SentimentAnalysis, Analysis, Message, Chat, Contact,
          User, Company, WhatsAppConfig, Notification
        ], { logging: ['error'] })),
      ],
    }).compile();

    dataSource = module.get<DataSource>(getDataSourceToken());
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
  })

  afterEach(async () => {
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
  });

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
    if (module) await module.close();
  });

  it('Chat Factory', async () => {
    const chat = await ChatFactory.transient({ manager: queryRunner.manager }).create();

    expect(chat.id).toBeDefined();
  });

  it('Client Factory', async () => {
    const client = await ContactFactory.transient({ manager: queryRunner.manager }).create();

    expect(client).toBeDefined();
    expect(client.id).toBeDefined();
  });

  it('User Factory', async () => {
    const user = await UserFactory.transient({ manager: queryRunner.manager }).create();

    expect(user).toBeDefined();
    expect(user.id).toBeDefined();
  });

  it('Message Factory', async () => {
    const message = await MessageFactory.transient({ manager: queryRunner.manager }).create();

    expect(message).toBeDefined();
    expect(message.id).toBeDefined();
    expect(message.content).toBeDefined();
    expect(message.senderType).toBeDefined();
  })

  it('Analysis factory', async () => {
    const analysis = await AnalysisFactory.params({ createdAt: subYears(new Date(), 2) })
      .transient({ manager: queryRunner.manager }).create();

    expect(analysis.id).toBeDefined();
    expect(analysis.message).toBeDefined();
  });

  it('Sentiment Analysis factory', async () => {
    const sentiment = await SentimentAnalysisFactory.transient({ manager: queryRunner.manager }).create();

    expect(sentiment.id).toBeDefined();
    expect(sentiment.analysis.id).toBeDefined();
    expect(sentiment.analysis.message.id).toBeDefined();
  })
});
