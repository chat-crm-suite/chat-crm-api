// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { ClsService } from 'nestjs-cls';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { App } from 'supertest/types';

import { SentimentService } from '../analysis/sentiment/sentiment.service';
import { MessageService } from '../message/message.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

/**
 * T4: `GET /conversations/:id/sentiment` delegates to the sentiment service
 * and serializes the response through the shared contract, so the app
 * receives exactly the parsed shape.
 */
describe('ConversationsController sentiment endpoint (T4)', () => {
  let app: INestApplication<App>;

  const getConversationSentiment = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        { provide: ConversationsService, useValue: {} },
        { provide: MessageService, useValue: {} },
        {
          provide: SentimentService,
          useValue: { getConversationSentiment },
        },
        { provide: ClsService, useValue: { get: jest.fn() } },
        // Same registration as the app: DI provides the interceptor's Reflector.
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('returns the tone of the requested conversation', async () => {
    const sentiment = {
      avgPos: 0.52,
      avgNeu: 0.31,
      avgNeg: 0.17,
      totalMessages: 48,
      dominant: 'POS',
    };
    getConversationSentiment.mockResolvedValue(sentiment);

    const response = await request(app.getHttpServer())
      .get('/conversations/conv-1/sentiment')
      .expect(200);

    expect(response.body).toEqual(sentiment);
    expect(getConversationSentiment).toHaveBeenCalledWith('conv-1');
  });

  it('serializes the response through the shared contract', async () => {
    getConversationSentiment.mockResolvedValue({
      avgPos: 0,
      avgNeu: 0,
      avgNeg: 0,
      totalMessages: 0,
      dominant: 'NEU',
      ignored: 'not part of the contract',
    });

    const response = await request(app.getHttpServer())
      .get('/conversations/conv-2/sentiment')
      .expect(200);

    expect(response.body).toEqual({
      avgPos: 0,
      avgNeu: 0,
      avgNeg: 0,
      totalMessages: 0,
      dominant: 'NEU',
    });
  });
});
