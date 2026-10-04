import { createZodDto } from 'nestjs-zod';

import {
  CreateContactSchema,
  UpdateContactSchema,
} from '../../../contracts/index';

export class CreateContactDto extends createZodDto(CreateContactSchema) {}

export class UpdateContactDto extends createZodDto(UpdateContactSchema) {}
