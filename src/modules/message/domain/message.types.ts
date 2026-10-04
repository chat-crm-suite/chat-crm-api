import type {
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from '../../../contracts/index';

export { MessageType } from '../../../contracts/index';
export type {
  MessageDirection,
  MessageSenderType,
  MessageStatus,
} from '../../../contracts/index';

export interface CanonicalContent {
  body?: string; // texto plano o caption
  mediaUrl?: string; // url local (servidor) o link externo
  filename?: string; // solo para documentos
}

export interface CanonicalMessage {
  chatId: string;
  type: MessageType;
  direction: MessageDirection;
  senderType: MessageSenderType;
  senderId?: string;
  content: CanonicalContent;
  externalId?: string; // ID que asigna WhatsApp
  status: MessageStatus;
}
