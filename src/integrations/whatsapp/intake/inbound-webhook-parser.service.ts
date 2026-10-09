// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { InboundMessageDiscardedEvent } from '../events/inbound-message-discarded.event';
import {
  mapInboundWebhookToMessages,
  type InboundDiscardListener,
} from '../mappers/inbound-message-parsers.registry';
import type {
  InboundDiscard,
  InboundWebhookResult,
} from '../types/inbound-message.types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Thin parse-and-publish border (ticket #21): wraps the pure strict parsers
 * with the event bus. Pure parsers contain no logging; this border does —
 * one discard fact per discarded message on the bus, plus warnings for
 * structural degradation (missing entry list, values without channel id).
 * Never throws on malformed webhooks: the controller always answers 200.
 */
@Injectable()
export class InboundWebhookParserService {
  constructor(
    private readonly eventBus: EventBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InboundWebhookParserService.name);
  }

  parseWebhook(body: unknown): InboundWebhookResult {
    const empty: InboundWebhookResult = {
      messages: [],
      errors: [],
      statuses: [],
    };
    if (!isRecord(body) || body.object !== 'whatsapp_business_account') {
      return empty;
    }
    if (!Array.isArray(body.entry)) {
      this.logger.warn('whatsapp webhook without entry list; nothing to parse');
      return empty;
    }

    const discarded: InboundDiscard[] = [];
    const collect: InboundDiscardListener = (fact) => {
      discarded.push(fact);
    };
    const result = mapInboundWebhookToMessages(body, collect);

    for (const fact of discarded) {
      this.eventBus.publish(
        new InboundMessageDiscardedEvent(
          fact.messageId,
          fact.type,
          fact.reason,
        ),
      );
    }
    const channelSkips = discarded.filter(
      (fact) => fact.reason === 'missing-channel-id',
    );
    if (channelSkips.length > 0) {
      this.logger.warn(
        {
          skipped: channelSkips.length,
          messageIds: channelSkips.map((fact) => fact.messageId),
        },
        'whatsapp webhook values without channel id; messages omitted',
      );
    }

    return result;
  }
}
