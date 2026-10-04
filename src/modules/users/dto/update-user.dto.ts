import { createZodDto } from 'nestjs-zod';

import { UpdateUserSchema } from '../../../contracts/index';

export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}
