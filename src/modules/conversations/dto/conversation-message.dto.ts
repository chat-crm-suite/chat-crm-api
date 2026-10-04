import type { SendConversationMessageInput } from '../../../contracts/index';

/**
 * Internal message payload used by the queue (`save-message`): the wire shape
 * minus `to` (the conversation is `room`), plus the optional `mediaUrl`
 * produced by the upload flow.
 */
export interface ConversationMessageDto
  extends Omit<SendConversationMessageInput, 'msg' | 'to'> {
  msg: SendConversationMessageInput['msg'] & { mediaUrl?: string };
}
