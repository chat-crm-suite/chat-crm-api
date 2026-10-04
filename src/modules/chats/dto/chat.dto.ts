import { createZodDto } from 'nestjs-zod';

import { CreateChatSchema, UpdateChatSchema } from '../../../contracts/index';

export class CreateChatDto extends createZodDto(CreateChatSchema) {}

export class UpdateChatDto extends createZodDto(UpdateChatSchema) {}
