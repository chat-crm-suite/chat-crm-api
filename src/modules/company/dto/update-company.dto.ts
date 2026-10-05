import { createZodDto } from 'nestjs-zod';

import { UpdateCompanySchema } from '../../../contracts/index';

export class UpdateCompanyDto extends createZodDto(UpdateCompanySchema) {}
