// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { WhatsappNotificationError } from '@daweto/whatsapp-api-types';

import type { WhatsAppErrorInfo } from './clients/whatsapp.client';

/**
 * Graph codes for a re-engagement/24h-window rejection: the customer has not
 * written in the last 24 h, so only a template can open the conversation
 * again. `131047` is the only re-engagement code the codebase models today.
 */
const RE_ENGAGEMENT_CODES = new Set(['131047']);

/**
 * Legacy `conversation:message:error` shape plus the fields the app reads to
 * offer the "Enviar plantilla" action (`hasAction`) with the recipient the
 * action must reuse (`to`).
 */
export type LegacyWhatsAppError = WhatsappNotificationError & {
  hasAction?: boolean;
  to?: string;
};

function isReEngagementCode(code: unknown): boolean {
  return RE_ENGAGEMENT_CODES.has(String(code));
}

/**
 * #9: a 24h-window failure gets the template-action hint (`hasAction`, and the
 * recipient when it is known). Any other provider error is returned untouched,
 * so its shape never changes.
 */
export function withReEngagementAction<T extends WhatsappNotificationError>(
  error: T,
  recipient?: string,
): T & { hasAction?: boolean; to?: string } {
  if (!isReEngagementCode(error.code)) return error;

  return {
    ...error,
    hasAction: true,
    ...(recipient ? { to: recipient } : {}),
  };
}

/**
 * Legacy `conversation:message:error` shape, shared by the socket send path
 * (`WhatsAppService`) and the T5 outbound pipeline (`AgentMessageSender`).
 */
export function toLegacyWhatsAppError(
  error: WhatsAppErrorInfo,
  messageType: string,
  recipient?: string,
): LegacyWhatsAppError {
  const code = Number(error.code);

  return withReEngagementAction(
    {
      code: Number.isFinite(code) ? code : 0,
      title: 'Whatsapp cliente error',
      message: error.message,
      error_data: {
        details: `Request whatsapp client error for ${messageType} message`,
      },
    },
    recipient,
  );
}
