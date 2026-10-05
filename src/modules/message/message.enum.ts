/**
 * Message domain values live in the shared contracts (`src/contracts/message.contract.ts`).
 * Re-exported here so existing import paths keep working across the API.
 *
 * v2 values are string unions validated by Zod (`MESSAGE_TYPES`, ...), so the
 * legacy `MessageType.TEXT`-style value objects no longer exist.
 */
export {
  MESSAGE_DIRECTIONS,
  MESSAGE_SENDER_TYPES,
  MESSAGE_STATUSES,
  MESSAGE_TYPES,
} from '../../contracts/index';

export type {
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from '../../contracts/index';
