import { createZodDto } from 'nestjs-zod';

import { SentimentTrendQuerySchema } from '../../../../contracts/index';

export class SentimentTrendQuery extends createZodDto(
  SentimentTrendQuerySchema,
) {}
