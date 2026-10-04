import { createZodDto } from 'nestjs-zod';

import { WebhookQuerySchema } from '../../../contracts/index';

export class WebhookQuery extends createZodDto(WebhookQuerySchema) {}
