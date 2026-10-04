import { createZodDto } from 'nestjs-zod';

import { BroadcastMessageSchema } from '../../../contracts/index';

/**
 * `GET /chats/:id/messages` item + `chat:message:broadcast` payload.
 */
export class BroadcastDto extends createZodDto(BroadcastMessageSchema) {}
