// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createZodDto } from 'nestjs-zod';

import { ConversationSentimentSchema } from '@contracts';

export class ConversationSentimentDto extends createZodDto(
  ConversationSentimentSchema,
) {}
