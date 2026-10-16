// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { of, throwError } from 'rxjs';

import { SentimentClient } from './sentiment.client';
import { SENTIMENT_MAX_TEXT_LENGTH } from './sentiment.constants';

/**
 * T1: the client is a thin transport. It propagates failures so the service
 * can classify them (unavailable vs broken contract); it never fakes a
 * neutral analysis when the IA is unreachable.
 */
describe('SentimentClient (T1)', () => {
  const post = jest.fn();
  const logger = {
    setContext: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
  const config = { endpoint: 'http://ia.test/analyze_message', apiKey: '' };

  const build = (overrides: Partial<typeof config> = {}) =>
    new SentimentClient(
      { ...config, ...overrides } as never,
      { post } as never,
      logger as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('propagates transport failures instead of faking a neutral response', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    post.mockReturnValue(throwError(() => refused));

    await expect(build().analyze('hola')).rejects.toBe(refused);
  });

  it('returns the IA payload untouched on success', async () => {
    const data = {
      text: 'hola',
      label: 'POS',
      probabilities: { POS: 0.9, NEU: 0.05, NEG: 0.05 },
    };
    post.mockReturnValue(of({ data }));

    await expect(build().analyze('hola')).resolves.toEqual(data);
  });

  it('sends the shared IA key in X-IA-Key when one is configured', async () => {
    post.mockReturnValue(of({ data: {} }));

    await build({ apiKey: 'k'.repeat(64) }).analyze('hola');

    expect(post).toHaveBeenCalledWith(
      config.endpoint,
      { text: 'hola' },
      { headers: { 'X-IA-Key': 'k'.repeat(64) } },
    );
  });

  it('sends no key header when none is configured (dev IA)', async () => {
    post.mockReturnValue(of({ data: {} }));

    await build().analyze('hola');

    expect(post).toHaveBeenCalledWith(
      config.endpoint,
      { text: 'hola' },
      { headers: {} },
    );
  });

  it('trims the text to the IA limit so long messages are analysed, not rejected', async () => {
    post.mockReturnValue(of({ data: {} }));

    await build().analyze('a'.repeat(SENTIMENT_MAX_TEXT_LENGTH + 500));

    const [, body] = post.mock.calls[0] as [string, { text: string }];
    expect(body.text).toHaveLength(SENTIMENT_MAX_TEXT_LENGTH);
  });
});
