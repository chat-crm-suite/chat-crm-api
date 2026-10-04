import { createZodDto } from 'nestjs-zod';

import { SentimentTopQuerySchema } from '../../../../contracts/index';

export class SentimentTopQuery extends createZodDto(SentimentTopQuerySchema) {}
