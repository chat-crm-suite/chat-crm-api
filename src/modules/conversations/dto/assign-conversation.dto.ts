import { createZodDto } from 'nestjs-zod';

import { AssignConversationSchema } from '../../../contracts/index';

export class AssignConversationDto extends createZodDto(
  AssignConversationSchema,
) {}
