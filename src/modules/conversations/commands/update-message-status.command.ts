import type { MessageStatus } from '../../../contracts/index';

/** Meta delivery states T4 persists; `pending` is local and `played` is unused. */
export type DeliveryStatus = Extract<
  MessageStatus,
  'sent' | 'delivered' | 'read' | 'failed'
>;

export interface DeliveryStatusError {
  code?: string | null;
  message?: string | null;
}

/**
 * One Meta status callback, dispatched by the webhook after the 200. The
 * handler applies it by `wamid` and pushes the resulting patch live.
 */
export class UpdateMessageStatusCommand {
  constructor(
    public readonly wamid: string,
    public readonly status: DeliveryStatus,
    public readonly occurredAt: Date,
    public readonly error?: DeliveryStatusError | null,
  ) {}
}
