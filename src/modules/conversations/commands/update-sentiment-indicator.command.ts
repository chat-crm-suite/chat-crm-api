// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Command } from '@nestjs/cqrs';

export class UpdateSentimentIndicatorCommand extends Command<{
  conversationId?: string;
}> {
  constructor(
    public readonly probabilities: {
      pos: number;
      neu: number;
      neg: number;
    },
    public readonly conversationId?: string,
  ) {
    super();
  }
}
