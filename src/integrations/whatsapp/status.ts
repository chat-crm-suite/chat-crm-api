import type { DeliveryStatus } from '../../modules/conversations/commands/update-message-status.command';

/** Meta delivery states T4 persists; `pending` is local and `played` is unused. */
export const DELIVERY_STATUSES = [
  'sent',
  'delivered',
  'read',
  'failed',
] as const satisfies readonly DeliveryStatus[];

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return (
    typeof value === 'string' &&
    (DELIVERY_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Durable intake kind of one status tick. Scoped per state so the tick never
 * collides with the message event (or another state) of the same wamid.
 */
export function statusKind(status: DeliveryStatus): string {
  return `status:${status}`;
}

/** Meta sends unix seconds as a string; fall back to arrival time. */
export function toStatusDate(timestamp?: unknown): Date {
  const seconds = Number(timestamp);

  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : new Date();
}

export interface StatusErrorInfo {
  code: string | null;
  message: string | null;
}

/** First provider error of a failed status payload, if any. */
export function toStatusError(payload: unknown): StatusErrorInfo | null {
  if (!payload || typeof payload !== 'object') return null;

  const errors = (payload as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return null;

  const first = errors[0] as { code?: unknown; message?: unknown } | undefined;
  if (!first) return null;

  const code = first.code;

  return {
    code:
      typeof code === 'string' || typeof code === 'number'
        ? String(code)
        : null,
    message: typeof first.message === 'string' ? first.message : null,
  };
}
