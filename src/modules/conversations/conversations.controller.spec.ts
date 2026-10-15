// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ForbiddenException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
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
import { ConversationAccessService } from './realtime/conversation-access.service';
import { ConversationUploadsService } from './uploads/conversation-uploads.service';

/**
 * T4: `GET /conversations/:id/sentiment` delegates to the sentiment service,
 * scoped to the CLS company, and serializes the response through the shared
 * contract so the app receives exactly the parsed shape.
 */
describe('ConversationsController sentiment endpoint (T4)', () => {
  let app: INestApplication<App>;

  const getConversationSentiment = jest.fn();
  const getConversationMessages = jest.fn();
  const assertCanJoinConversation = jest.fn();
  const stage = jest.fn();
  const clsGet = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        { provide: ConversationsService, useValue: {} },
        { provide: MessageService, useValue: { getConversationMessages } },
        {
          provide: ConversationAccessService,
          useValue: { assertCanJoinConversation },
        },
        { provide: ConversationUploadsService, useValue: { stage } },
        {
          provide: SentimentService,
          useValue: { getConversationSentiment },
        },
        { provide: ClsService, useValue: { get: clsGet } },
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

  beforeEach(() => {
    jest.clearAllMocks();
    clsGet.mockReturnValue('company-1');
  });

  describe('POST /conversations/:id/uploads', () => {
    const staged = {
      uploadId: '0b9f6a3e-5c1d-4f7e-9a2b-3c4d5e6f7a8b',
      kind: 'document',
      mimeType: 'application/pdf',
      sizeBytes: 9,
      filename: 'cotizacion.pdf',
      durationMs: null,
      width: null,
      height: null,
      expiresAt: '2026-10-14T10:00:00.000Z',
    };

    it('stages the multipart file after the access check', async () => {
      stage.mockResolvedValue({ ...staged, expiresAt: new Date(staged.expiresAt) });

      const response = await request(app.getHttpServer())
        .post('/conversations/conv-1/uploads')
        .field('kind', 'document')
        .attach('file', Buffer.from('%PDF-1.7'), 'cotizacion.pdf')
        .expect(201);

      expect(response.body).toEqual(staged);
      expect(assertCanJoinConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ companyId: 'company-1' }),
      );
      const [conversationId, companyId, file, body] = stage.mock.calls[0] as [
        string,
        string,
        { originalname: string; path: string },
        unknown,
      ];
      expect([conversationId, companyId]).toEqual(['conv-1', 'company-1']);
      expect(file.originalname).toBe('cotizacion.pdf');
      expect(body).toEqual({ kind: 'document' });
    });

    it('requires a valid kind and a file', async () => {
      await request(app.getHttpServer())
        .post('/conversations/conv-1/uploads')
        .field('kind', 'location')
        .attach('file', Buffer.from('x'), 'a.txt')
        .expect(400);

      await request(app.getHttpServer())
        .post('/conversations/conv-1/uploads')
        .field('kind', 'image')
        .expect(400);

      expect(stage).not.toHaveBeenCalled();
    });

    it('refuses uploads into a conversation the caller may not reach', async () => {
      assertCanJoinConversation.mockRejectedValueOnce(
        new ForbiddenException('Conversation access denied'),
      );

      await request(app.getHttpServer())
        .post('/conversations/conv-other/uploads')
        .field('kind', 'image')
        .attach('file', Buffer.from('x'), 'a.png')
        .expect(403);
      expect(stage).not.toHaveBeenCalled();
    });
  });

  describe('GET /conversations/:id/messages', () => {
    const message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      clientMessageId: null,
      timestamp: '2026-10-13T10:00:00.000Z',
      status: 'delivered',
      sender: { id: 'cust-1', type: 'customer' },
      msg: { type: 'text', text: 'hola' },
    };

    it('checks access like the socket join, then returns the thread', async () => {
      clsGet.mockImplementation((key: string) =>
        key.includes('company') ? 'company-1' : 'user-1',
      );
      getConversationMessages.mockResolvedValue([message]);

      const response = await request(app.getHttpServer())
        .get('/conversations/conv-1/messages')
        .expect(200);

      expect(assertCanJoinConversation).toHaveBeenCalledWith('conv-1', {
        userId: 'user-1',
        companyId: 'company-1',
        authenticated: true,
      });
      expect(response.body).toEqual([message]);
    });

    it('refuses a conversation the caller may not reach', async () => {
      assertCanJoinConversation.mockRejectedValueOnce(
        new ForbiddenException('Conversation access denied'),
      );

      await request(app.getHttpServer())
        .get('/conversations/conv-other/messages')
        .expect(403);
      expect(getConversationMessages).not.toHaveBeenCalled();
    });
  });

  it('returns the tone of the requested conversation scoped to the company', async () => {
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
    expect(getConversationSentiment).toHaveBeenCalledWith(
      'conv-1',
      'company-1',
    );
  });

  it('returns 404 when the conversation is unknown or from another company', async () => {
    getConversationSentiment.mockRejectedValue(
      new NotFoundException('Conversation not found'),
    );

    await request(app.getHttpServer())
      .get('/conversations/foreign/sentiment')
      .expect(404);

    expect(getConversationSentiment).toHaveBeenCalledWith(
      'foreign',
      'company-1',
    );
  });

  it('rejects the read without a company context', async () => {
    clsGet.mockReturnValue(undefined);

    await request(app.getHttpServer())
      .get('/conversations/conv-1/sentiment')
      .expect(400);

    expect(getConversationSentiment).not.toHaveBeenCalled();
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
