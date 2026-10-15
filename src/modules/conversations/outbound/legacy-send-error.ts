// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { WhatsappNotificationError } from '@daweto/whatsapp-api-types';

import type { ChannelFailure } from '@modules/channels/ports/channel-adapter.port';

/**
 * Legacy `conversation:message:error` shape plus the fields the app reads to
 * offer the "Enviar plantilla" action (`hasAction`) with the recipient the
 * action must reuse (`to`).
 */
export type LegacySendError = WhatsappNotificationError & {
  hasAction?: boolean;
  to?: string;
};

/**
 * #9: the toast payload for a failed send. A closed reply window carries the
 * template action and the recipient; any other failure keeps the plain shape.
 */
export function toLegacySendError(
  error: ChannelFailure,
  messageType: string,
  recipient?: string,
): LegacySendError {
  const code = Number(error.code);
  const legacy: LegacySendError = {
    code: Number.isFinite(code) ? code : 0,
    title: 'Whatsapp cliente error',
    message: error.message,
    error_data: {
      details: `Request whatsapp client error for ${messageType} message`,
    },
  };

  if (!error.replyWindowClosed) return legacy;

  return { ...legacy, hasAction: true, ...(recipient ? { to: recipient } : {}) };
}
