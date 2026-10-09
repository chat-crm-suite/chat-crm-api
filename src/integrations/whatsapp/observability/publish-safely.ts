// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { EventBus } from '@nestjs/cqrs';
import type { PinoLogger } from 'nestjs-pino';

/**
 * Publishes one domain fact without ever letting a handler's failure bubble
 * into the inbound flow (ticket #24: handlers never throw, and this border
 * stays defensive anyway). Shared by the parse border and the media
 * enrichment so both degrade the same way. The inbound flow is already
 * durable; a lost observability fact is logged, never rethrown.
 */
export function publishSafely(
  eventBus: Pick<EventBus, 'publish'>,
  logger: PinoLogger,
  event: object,
  failureMessage: string,
  level: 'warn' | 'error' = 'warn',
): void {
  const report = (error: unknown): void => {
    if (level === 'error') {
      logger.error({ error }, failureMessage);
      return;
    }
    logger.warn({ error }, failureMessage);
  };

  try {
    void Promise.resolve(eventBus.publish(event as never)).catch(report);
  } catch (error: unknown) {
    report(error);
  }
}
