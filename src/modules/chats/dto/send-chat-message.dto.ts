import { MessageType } from "../../message/domain/message.types";
import { ChatMessageContent } from "../chat.types";
import { MessageSenderType } from "../../message/message.enum";
import { IsNotEmpty, IsNotEmptyObject, IsPhoneNumber } from "class-validator";

/**
 * @param room id of room and chat identify
 * @param to phone number to send
 * @param sender sender info
 * @param msg message attributes
 */
export class SendChatMessageDto {
  @IsNotEmpty()
  room: string;

  /** Empresa de origen, para asignación automática multi-empresa (Q4/Q15). */
  companyId?: string;

  @IsNotEmpty()
  @IsPhoneNumber()
  to: string;

  @IsNotEmptyObject()
  sender: {
    id: string,
    type: MessageSenderType,
  }

  @IsNotEmptyObject()
  msg: {
    type: MessageType;
    content: ChatMessageContent;
  }
}