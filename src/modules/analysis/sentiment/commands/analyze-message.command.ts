// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Requests a sentiment analysis for a message. `content` is the text to
 * analyze; when it is empty the processor falls back to `messages.body`.
 */
export class AnalyzeMessageCommand {
  constructor(
    public readonly messageId: string,
    public readonly content: string | null | undefined,
    public readonly conversationId?: string,
  ) {}
}
