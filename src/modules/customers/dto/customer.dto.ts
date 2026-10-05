import { createZodDto } from 'nestjs-zod';

import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
} from '../../../contracts/index';

export class CreateCustomerDto extends createZodDto(CreateCustomerSchema) {}

export class UpdateCustomerDto extends createZodDto(UpdateCustomerSchema) {}
