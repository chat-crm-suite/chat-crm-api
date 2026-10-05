import { createZodDto } from 'nestjs-zod';

import { CompanyMemberListQuerySchema } from '../../../contracts/index';

export class CompanyMemberListQueryDto extends createZodDto(
  CompanyMemberListQuerySchema,
) {}
