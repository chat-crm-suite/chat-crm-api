// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createZodDto } from 'nestjs-zod';

import {
  CreateChannelSchema,
  UpdateChannelSchema,
} from '../../../contracts/index';

export class CreateChannelDto extends createZodDto(CreateChannelSchema) {}

export class UpdateChannelDto extends createZodDto(UpdateChannelSchema) {}
