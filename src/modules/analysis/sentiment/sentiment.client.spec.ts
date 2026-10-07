// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { of, throwError } from 'rxjs';

import { SentimentClient } from './sentiment.client';

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
  const config = { endpoint: 'http://ia.test/analyze_message' };

  const build = () =>
    new SentimentClient(config as never, { post } as never, logger as never);

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
});
