// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Writable } from 'node:stream';
import pinoHttp, { type Options } from 'pino-http';

import { buildLoggerConfig } from './logger.config';

/**
 * T5: the logger is JSON in production by default (one line per log, pretty
 * only when `LOG_PRETTY=true`) while development keeps the pretty output.
 * The JSON fields follow a stable order with the correlation fields first.
 */
describe('logger configuration (T5)', () => {
  const pinoOptions = (env: { NODE_ENV?: string; LOG_PRETTY?: string }) => {
    const config = buildLoggerConfig(env);
    return config.pinoHttp as Options;
  };

  const formatter = (env: { NODE_ENV?: string; LOG_PRETTY?: string }) => {
    const log = pinoOptions(env).formatters?.log;
    if (!log) throw new Error('formatters.log is not configured');
    return log;
  };

  const captureOneLine = (
    env: { NODE_ENV?: string; LOG_PRETTY?: string },
    log: (logger: ReturnType<typeof pinoHttp>['logger']) => void,
  ): Record<string, unknown> => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });

    log(pinoHttp(pinoOptions(env), sink).logger);

    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith('\n')).toBe(true);
    expect(lines[0].trimEnd()).not.toContain('\n');
    return JSON.parse(lines[0]) as Record<string, unknown>;
  };

  describe('format selection', () => {
    it('emits JSON (no pretty transport) in production by default', () => {
      expect(pinoOptions({ NODE_ENV: 'production' }).transport).toBeUndefined();
    });

    it('keeps the pretty transport outside production by default', () => {
      expect(pinoOptions({ NODE_ENV: 'development' }).transport).toMatchObject({
        target: 'pino-pretty',
      });
    });

    it('enables pretty in production only when LOG_PRETTY=true', () => {
      expect(
        pinoOptions({ NODE_ENV: 'production', LOG_PRETTY: 'true' }).transport,
      ).toMatchObject({ target: 'pino-pretty' });
    });

    it('forces JSON in development when LOG_PRETTY=false', () => {
      expect(
        pinoOptions({ NODE_ENV: 'development', LOG_PRETTY: 'false' })
          .transport,
      ).toBeUndefined();
    });

    it('keeps the level policy: debug outside production, info in production', () => {
      expect(pinoOptions({ NODE_ENV: 'development' }).level).toBe('debug');
      expect(pinoOptions({ NODE_ENV: 'production' }).level).toBe('info');
    });
  });

  describe('field order', () => {
    it('puts the correlation fields first, in a stable order', () => {
      const ordered = formatter({ NODE_ENV: 'production' })({
        reason: 'ia_unavailable',
        durationMs: 12,
        conversationId: 'conv-1',
        messageId: 'msg-1',
        analysisId: 'ana-1',
        context: 'SentimentService',
        responseTime: 34,
      });

      expect(Object.keys(ordered)).toEqual([
        'context',
        'analysisId',
        'messageId',
        'conversationId',
        'durationMs',
        'reason',
        'responseTime',
      ]);
    });

    it('keeps unknown fields in call-site order after the known ones', () => {
      const ordered = formatter({ NODE_ENV: 'production' })({
        zeta: true,
        messageId: 'msg-1',
        alpha: true,
      });

      expect(Object.keys(ordered)).toEqual(['messageId', 'zeta', 'alpha']);
    });

    it('orders the inbound correlation fields (media ids and type) stably', () => {
      const ordered = formatter({ NODE_ENV: 'production' })({
        reason: 'missing-media-id',
        type: 'image',
        mediaId: 'media-1',
        attachmentId: 'att-1',
        messageId: 'wamid-1',
        context: 'InboundDiscardLogHandler',
      });

      expect(Object.keys(ordered)).toEqual([
        'context',
        'messageId',
        'attachmentId',
        'mediaId',
        'type',
        'reason',
      ]);
    });
  });

  describe('production output', () => {
    it('writes one JSON line per log with ordered fields', () => {
      const parsed = captureOneLine({ NODE_ENV: 'production' }, (logger) =>
        logger.info(
          { context: 'SentimentService', analysisId: 'ana-1', messageId: 'msg-1' },
          'analysis completed',
        ),
      );

      expect(parsed).toMatchObject({
        level: 30,
        context: 'SentimentService',
        analysisId: 'ana-1',
        messageId: 'msg-1',
        msg: 'analysis completed',
      });
      expect(typeof parsed.time).toBe('number');

      const keys = Object.keys(parsed);
      const positions = [
        'level',
        'time',
        'context',
        'analysisId',
        'messageId',
        'msg',
      ].map((key) => keys.indexOf(key));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });
  });
});
