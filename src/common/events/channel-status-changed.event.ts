// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ChannelStatus, ChannelStatusChanged } from '../../contracts/index';

/**
 * A channel went down (`error`) or came back (`active`). Published by the
 * channels module on the CQRS bus; the conversations module relays it to the
 * `company:{id}` socket room as `channel:status:changed`, the notifications
 * module tells the admins. `previousStatus` (server-side only) tells a
 * recovery (`error` → `active`) from a first setup (`pending` → `active`).
 */
export class ChannelStatusChangedEvent {
  constructor(
    public readonly companyId: string,
    public readonly payload: ChannelStatusChanged,
    public readonly previousStatus?: ChannelStatus,
  ) {}
}
