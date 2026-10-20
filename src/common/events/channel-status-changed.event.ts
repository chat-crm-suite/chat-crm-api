// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ChannelStatusChanged } from '../../contracts/index';

/**
 * A channel went down (`error`) or came back (`active`). Published by the
 * channels module on the CQRS bus; the conversations module relays it to the
 * `company:{id}` socket room as `channel:status:changed`.
 */
export class ChannelStatusChangedEvent {
  constructor(
    public readonly companyId: string,
    public readonly payload: ChannelStatusChanged,
  ) {}
}
