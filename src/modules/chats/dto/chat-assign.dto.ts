import { createZodDto } from 'nestjs-zod';

import { ChatAssignSchema } from '../../../contracts/index';

export class ChatAssignDto extends createZodDto(ChatAssignSchema) {}
