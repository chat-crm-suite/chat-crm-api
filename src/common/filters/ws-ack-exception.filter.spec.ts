// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';

import { WsAckExceptionFilter, toAck } from './ws-ack-exception.filter';

describe('WsAckExceptionFilter', () => {
  const host = (ack: unknown) =>
    ({ getArgByIndex: (index: number) => (index === 2 ? ack : undefined) }) as
      ArgumentsHost;

  it('maps known exceptions to typed acknowledgement codes', () => {
    expect(toAck(new ZodValidationException({ issues: [] }))).toMatchObject({
      ok: false,
      code: 'validation',
    });
    expect(toAck(new ForbiddenException('No access'))).toEqual({
      ok: false,
      code: 'forbidden',
      message: 'No access',
    });
    expect(toAck(new NotFoundException('Gone'))).toMatchObject({
      code: 'not_found',
    });
  });

  it('answers channel_unavailable with the channel reason', () => {
    expect(
      toAck(
        new ConflictException({
          code: 'channel_unavailable',
          message: 'El token de acceso de WhatsApp venció o fue revocado.',
        }),
      ),
    ).toEqual({
      ok: false,
      code: 'channel_unavailable',
      message: 'El token de acceso de WhatsApp venció o fue revocado.',
    });
  });

  it('never leaks internal error messages', () => {
    expect(toAck(new Error('db password wrong'))).toEqual({
      ok: false,
      code: 'internal',
      message: 'Unexpected error',
    });
    expect(toAck('boom')).toMatchObject({ code: 'internal' });
  });

  it('answers through the acknowledgement callback when there is one', () => {
    const ack = jest.fn();

    new WsAckExceptionFilter().catch(new ForbiddenException('No'), host(ack));

    expect(ack).toHaveBeenCalledWith({
      ok: false,
      code: 'forbidden',
      message: 'No',
    });
  });

  it('tolerates requests sent without an acknowledgement', () => {
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    expect(() =>
      new WsAckExceptionFilter().catch(new Error('x'), host(undefined)),
    ).not.toThrow();

    logged.mockRestore();
  });
});
