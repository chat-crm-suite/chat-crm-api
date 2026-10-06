// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { firstValueFrom as first, map, retry, tap, timeout } from 'rxjs';
import {
  SENTIMENT_RETRIES as retries,
  SENTIMENT_TIMEOUT as time,
} from './sentiment.constants';
import { SentimentResponse as Response } from './sentiment.interface';
import { SentimentLabel } from './sentiment.enum';
import type { ConfigType } from '@nestjs/config';
import sentimentConfig from '../../../config/sentiment.config';

@Injectable()
export class SentimentClient {
  constructor(
    @Inject(sentimentConfig.KEY)
    private readonly config: ConfigType<typeof sentimentConfig>,
    private readonly http: HttpService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SentimentClient.name);
  }

  async analyze(text: string) {
    const res$ = this.http.post<Response>(this.config.endpoint, { text }).pipe(
      retry(retries),
      timeout(time),
      tap(({ data }) => this.logger.debug(data, 'Fetch Completed')),
      map(({ data }) => data),
    );

    return await first(res$).catch((err: unknown) => {
      this.logger.error({ err }, `Error calling IA Api with text="${text}"`);

      const analysis: Response = {
        text: '',
        label: SentimentLabel.NEUTRAL,
        probabilities: {
          POS: 0,
          NEU: 0.1,
          NEG: 0,
        },
      };

      return analysis;
    });
  }
}
