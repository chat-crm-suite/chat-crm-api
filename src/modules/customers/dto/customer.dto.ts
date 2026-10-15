// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createZodDto } from 'nestjs-zod';

import {
  BulkDeleteCustomersSchema,
  CreateCustomerSchema,
  CreateTagSchema,
  CustomerTableQuerySchema,
  SetCustomerTagsSchema,
  UpdateCustomerSchema,
} from '@contracts';

export class CreateCustomerDto extends createZodDto(CreateCustomerSchema) {}

export class UpdateCustomerDto extends createZodDto(UpdateCustomerSchema) {}

export class CustomerTableQueryDto extends createZodDto(CustomerTableQuerySchema) {}

export class CreateTagDto extends createZodDto(CreateTagSchema) {}

export class SetCustomerTagsDto extends createZodDto(SetCustomerTagsSchema) {}

export class BulkDeleteCustomersDto extends createZodDto(BulkDeleteCustomersSchema) {}
