import { createZodDto } from 'nestjs-zod';

import {
  CreateChannelSchema,
  UpdateChannelSchema,
} from '../../../contracts/index';

export class CreateChannelDto extends createZodDto(CreateChannelSchema) {}

export class UpdateChannelDto extends createZodDto(UpdateChannelSchema) {}
