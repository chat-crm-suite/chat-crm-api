/**
 * Legacy import path (still consumed by
 * `src/integrations/whatsapp/types/whatsapp.types.ts`). Message domain values
 * live in the shared contracts (`src/contracts/message.contract.ts`).
 */
export type {
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from '../../../contracts/index';
