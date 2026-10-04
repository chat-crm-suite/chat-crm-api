import { createZodDto } from 'nestjs-zod';

import {
  CreateWhatsAppConfigSchema,
  UpdateWhatsAppConfigSchema,
  WhatsAppConfigSchema,
} from '../../../contracts/index';

export class CreateWhatsAppConfigDto extends createZodDto(
  CreateWhatsAppConfigSchema,
) {}

export class UpdateWhatsAppConfigDto extends createZodDto(
  UpdateWhatsAppConfigSchema,
) {}

export class WhatsAppConfigResponseDto extends createZodDto(
  WhatsAppConfigSchema,
) {}
