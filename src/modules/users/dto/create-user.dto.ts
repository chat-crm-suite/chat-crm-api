import { createZodDto } from 'nestjs-zod';

import { CreateUserSchema } from '../../../contracts/index';

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
