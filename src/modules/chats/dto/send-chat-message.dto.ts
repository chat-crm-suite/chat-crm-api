import { createZodDto } from 'nestjs-zod';

import { SendChatMessageSchema } from '../../../contracts/index';

/**
 * `chat:message:send` payload (frontend -> gateway).
 */
export class SendChatMessageDto extends createZodDto(SendChatMessageSchema) {}
