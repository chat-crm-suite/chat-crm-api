import { createZodDto } from 'nestjs-zod';

import { SendConversationMessageSchema } from '../../../contracts/index';

/**
 * `conversation:message:send` payload (frontend -> gateway).
 */
export class SendConversationMessageDto extends createZodDto(
  SendConversationMessageSchema,
) {}
