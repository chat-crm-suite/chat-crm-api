import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, EntityTarget, QueryRunner } from 'typeorm';

import * as Entities from '@entities';
import {
  AnalysisFactory,
  ChannelFactory,
  CompanyFactory,
  CompanyMemberFactory,
  ConversationFactory,
  CustomerFactory,
  MessageFactory,
  SentimentResultFactory,
  UserFactory,
} from '@factories';
import { getTestConfig } from './helpers/test-database.helper';

const entities = Object.values(Entities) as EntityTarget<unknown>[];

jest.setTimeout(120_000);

describe('Entity Factories Integration Tests', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(
          getTestConfig(entities, { logging: ['error'] }),
        ),
      ],
    }).compile();

    dataSource = module.get<DataSource>(getDataSourceToken());
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
  });

  afterEach(async () => {
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
  });

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
    if (module) await module.close();
  });

  const manager = () => queryRunner.manager;

  it('User Factory', async () => {
    const user = await UserFactory.transient({ manager: manager() }).create();

    expect(user).toBeDefined();
    expect(user.id).toBeDefined();
    expect(user.username).toBeDefined();
    expect(user.passwordHash).toBeDefined();
  });

  it('Company Factory', async () => {
    const company = await CompanyFactory.transient({ manager: manager() }).create();

    expect(company.id).toBeDefined();
    expect(company.name).toBeDefined();
  });

  it('Channel Factory (valid company FK)', async () => {
    const channel = await ChannelFactory.transient({ manager: manager() }).create();

    expect(channel.id).toBeDefined();
    expect(channel.companyId).toBeDefined();
  });

  it('CompanyMember Factory (user + company FKs)', async () => {
    const member = await CompanyMemberFactory.transient({
      manager: manager(),
    }).create();

    expect(member.id).toBeDefined();
    expect(member.userId).toBeDefined();
    expect(member.companyId).toBeDefined();
    expect(member.role).toBe('agent');
    expect(member.status).toBe('active');
  });

  it('Customer Factory (was Contact)', async () => {
    const customer = await CustomerFactory.transient({
      manager: manager(),
    }).create();

    expect(customer).toBeDefined();
    expect(customer.id).toBeDefined();
    expect(customer.companyId).toBeDefined();
    expect(customer.displayName).toBeDefined();
  });

  it('Conversation Factory (was Chat, with company/customer/channel)', async () => {
    const conversation = await ConversationFactory.transient({
      manager: manager(),
    }).create();

    expect(conversation.id).toBeDefined();
    expect(conversation.companyId).toBeDefined();
    expect(conversation.customerId).toBeDefined();
    expect(conversation.channelId).toBeDefined();
    expect(conversation.status).toBe('open');
  });

  it('Message Factory (conversation + company FKs)', async () => {
    const message = await MessageFactory.transient({ manager: manager() }).create();

    expect(message).toBeDefined();
    expect(message.id).toBeDefined();
    expect(message.conversationId).toBeDefined();
    expect(message.companyId).toBeDefined();
    expect(message.body).toBeDefined();
    expect(message.senderType).toBe('customer');
    expect(message.direction).toBe('inbound');
  });

  it('Message Factory with an explicit sender member', async () => {
    const member = await CompanyMemberFactory.transient({
      manager: manager(),
    }).create();

    const message = await MessageFactory.transient({ manager: manager() }).create({
      senderType: 'member',
      senderMemberId: member.id,
      direction: 'outbound',
    });

    expect(message.senderMemberId).toBe(member.id);
    expect(message.direction).toBe('outbound');
  });

  it('Analysis factory (v2 header linked to message + conversation)', async () => {
    const analysis = await AnalysisFactory.transient({
      manager: manager(),
    }).create();

    expect(analysis.id).toBeDefined();
    expect(analysis.message).toBeDefined();
    expect(analysis.messageId).toBeDefined();
    expect(analysis.conversationId).toBeDefined();
    expect(analysis.companyId).toBeDefined();
  });

  it('Analysis factory accepts a persisted message reference', async () => {
    const message = await MessageFactory.transient({ manager: manager() }).create();

    const analysis = await AnalysisFactory.transient({ manager: manager() }).create({
      message: { id: message.id },
    });

    expect(analysis.messageId).toBe(message.id);
    expect(analysis.conversationId).toBe(message.conversationId);
    expect(analysis.companyId).toBe(message.companyId);
  });

  it('Sentiment Result factory (was SentimentAnalysis, 1:1 detail)', async () => {
    const sentiment = await SentimentResultFactory.transient({
      manager: manager(),
    }).create();

    expect(sentiment.analysis).toBeDefined();
    expect(sentiment.analysis.id).toBeDefined();
    expect(sentiment.analysis.message?.id).toBeDefined();
    expect(sentiment.label).toBeDefined();
    expect(sentiment.scorePositive).toBeDefined();
    expect(sentiment.scoreNeutral).toBeDefined();
    expect(sentiment.scoreNegative).toBeDefined();
  });

  it('Sentiment Result factory accepts label + scores', async () => {
    const sentiment = await SentimentResultFactory.transient({
      manager: manager(),
    }).create({
      label: 'negative',
      scorePositive: 0.1,
      scoreNeutral: 0.2,
      scoreNegative: 0.7,
    });

    expect(sentiment.label).toBe('negative');
    expect(Number(sentiment.scoreNegative)).toBe(0.7);
  });
});
