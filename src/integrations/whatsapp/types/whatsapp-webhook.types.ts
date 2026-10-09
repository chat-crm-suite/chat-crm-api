// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  WhatsappNotification,
  WhatsappNotificationChange,
  WhatsappNotificationContact,
  WhatsappNotificationError,
  WhatsappNotificationMessage,
  WhatsappNotificationStatus,
} from '@daweto/whatsapp-api-types';

/**
 * Layer 1 of the inbound domain (ticket #20 expand): the provider-raw
 * webhook vocabulary. These are aliases over the Meta SDK shapes — the
 * `WhatsApp`-prefixed names never leave the intake boundary. Zero behavior
 * change: no caller migrates in this ticket.
 */
export type WhatsAppWebhook = WhatsappNotification;
export type WhatsAppWebhookChange = WhatsappNotificationChange;
export type WhatsAppWebhookContact = WhatsappNotificationContact;
export type WhatsAppWebhookMessage = WhatsappNotificationMessage;
export type WhatsAppWebhookStatus = WhatsappNotificationStatus;
export type WhatsAppWebhookError = WhatsappNotificationError;
