import { createZodDto } from 'nestjs-zod';

import { UserSearchQuerySchema } from '../../../contracts/index';

export class UserSearchDto extends createZodDto(UserSearchQuerySchema) {}
