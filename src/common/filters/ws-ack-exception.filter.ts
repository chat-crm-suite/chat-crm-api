// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { SendMessageAck, SendMessageErrorCode } from '@contracts';

/** Position of the socket.io acknowledgement callback in a ws handler call. */
const ACK_ARG_INDEX = 2;

/**
 * Answers a failed socket request through its acknowledgement instead of the
 * fire-and-forget `exception` event: the client awaiting `emitWithAck` gets
 * `{ ok: false, code, message }` and can fail its optimistic row at once,
 * rather than waiting for a timeout.
 */
@Catch()
export class WsAckExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WsAckExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ack = host.getArgByIndex<((response: SendMessageAck) => void) | undefined>(
      ACK_ARG_INDEX,
    );
    const response = toAck(exception);

    if (response.ok === false && response.code === 'internal') {
      this.logger.error(exception);
    }

    if (typeof ack === 'function') ack(response);
  }
}

/** Maps an exception to the acknowledgement contract (never leaks internals). */
export function toAck(exception: unknown): SendMessageAck {
  const code = errorCode(exception);
  const message =
    code === 'internal' || !(exception instanceof Error)
      ? 'Unexpected error'
      : exception.message;

  return { ok: false, code, message };
}

function errorCode(exception: unknown): SendMessageErrorCode {
  // `ZodValidationException` extends `BadRequestException`.
  if (exception instanceof BadRequestException) return 'validation';
  if (exception instanceof ForbiddenException) return 'forbidden';
  if (exception instanceof NotFoundException) return 'not_found';
  return 'internal';
}
