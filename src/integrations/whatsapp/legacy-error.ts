// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { WhatsappNotificationError } from '@daweto/whatsapp-api-types';

import type { WhatsAppErrorInfo } from './clients/whatsapp.client';

/**
 * Legacy `conversation:message:error` shape, shared by the socket send path
 * (`WhatsAppService`) and the T5 outbound pipeline (`AgentMessageSender`).
 */
export function toLegacyWhatsAppError(
  error: WhatsAppErrorInfo,
  messageType: string,
): WhatsappNotificationError {
  const code = Number(error.code);

  return {
    code: Number.isFinite(code) ? code : 0,
    title: 'Whatsapp cliente error',
    message: error.message,
    error_data: {
      details: `Request whatsapp client error for ${messageType} message`,
    },
  };
}
