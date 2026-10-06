// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ChannelTransmission } from '../../../../modules/channels/channels.service';
import { MessageContext } from '../../types/whatsapp.types';

export interface ContentHandlerPort<T> {
  handle(
    content: T,
    context: MessageContext,
    transmission: ChannelTransmission,
  ): Promise<void> | void;
}
