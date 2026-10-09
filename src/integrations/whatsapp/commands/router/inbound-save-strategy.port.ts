// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ChannelTransmission } from '@modules/channels/channels.service';
import type { InboundMessageContext } from '../../types/inbound-message.types';

/**
 * One save behavior per inbound content type (glossary: the Inbound Router
 * "resolves an inbound message to the save behavior for its content type").
 * Implementations own persistence only; parsing and emission live elsewhere.
 */
export interface InboundSaveStrategyPort<T> {
  handle(
    content: T,
    context: InboundMessageContext,
    transmission: ChannelTransmission,
  ): Promise<void> | void;
}
