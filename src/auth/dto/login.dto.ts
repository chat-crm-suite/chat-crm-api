import { createZodDto } from 'nestjs-zod';

import { LoginSchema } from '../../contracts/index';

export class LoginDto extends createZodDto(LoginSchema) {}
