// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Socket namespaces (single source of truth).
 *
 * - API: consumed by `@WebSocketGateway({ namespace })`.
 * - Frontend: consumed to build the socket URL (`<base>/<namespace>`).
 *
 * Rules:
 * - Only plain constants here (must stay framework-free, like the rest of
 *   this folder).
 * - A new gateway must add its namespace here instead of hardcoding the
 *   string on either side.
 */
export const SOCKET_NAMESPACES = {
  conversation: 'conversation',
} as const;

export type SocketNamespace =
  (typeof SOCKET_NAMESPACES)[keyof typeof SOCKET_NAMESPACES];
