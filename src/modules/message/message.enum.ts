/**
 * Message enums live in the shared contracts (`src/contracts/message.contract.ts`).
 * Re-exported here so existing imports keep working across the API.
 *
 * Historical note: `FILE`/`AUDIO`/`VIDEO` are not persisted yet and the legacy
 * `user` sender type was folded into `agent` (legacy rows are treated as agent).
 */
export {
  MessageType,
  MessageSenderType,
  MessageStatus,
  MessageDirection,
} from '../../contracts/index';
