import { MessageSenderType, MessageType } from "../../message/message.enum";
import { ChatMessageContent } from "../chat.types";

export class ChatMessageDto {
  room: string; // This is chatId

  /** Empresa de origen, para asignación automática multi-empresa (Q4/Q15). */
  companyId?: string;

  sender: {
    id: string,
    type: MessageSenderType,
  }

  msg: {
    type: MessageType;
    mediaUrl?: string;
    content: ChatMessageContent;
  }
}