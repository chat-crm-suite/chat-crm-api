// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Legacy import path for the message domain values. The canonical definition
 * lives in the shared contracts (`src/contracts/message.contract.ts`); this
 * module only re-exports it for callers that still import from here.
 */
export type {
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from '@contracts';
