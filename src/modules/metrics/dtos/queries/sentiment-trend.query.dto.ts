// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createZodDto } from 'nestjs-zod';

import { SentimentTrendQuerySchema } from '../../../../contracts/index';

export class SentimentTrendQuery extends createZodDto(
  SentimentTrendQuerySchema,
) {}
