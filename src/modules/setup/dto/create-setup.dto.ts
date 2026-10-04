import { createZodDto } from 'nestjs-zod';

import { CreateSetupSchema } from '../../../contracts/index';

export class CreateSetupDto extends createZodDto(CreateSetupSchema) {}
