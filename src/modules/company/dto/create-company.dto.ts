import { createZodDto } from 'nestjs-zod';

import { CreateCompanySchema } from '../../../contracts/index';

export class CreateCompanyDto extends createZodDto(CreateCompanySchema) {}
