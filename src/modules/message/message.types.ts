import type {
  MessageSenderType,
  MessageStatus,
  MessageType,
} from '../../contracts/index';

/**
 * `GET /conversations/:id/messages` item + `conversation:message:broadcast`
 * payload (v2). Replaces the legacy `BroadcastDto` from the chats module.
 */
export interface ConversationMessagePayload {
  id: string;
  conversationId: string;
  timestamp: Date;
  status: MessageStatus;
  sender: {
    id: string;
    type: MessageSenderType;
  };
  msg: {
    type: MessageType;
    mediaUrl?: string | null;
    content: {
      body?: string;
      link?: string;
      caption?: string;
      filename?: string;
    };
  };
}
