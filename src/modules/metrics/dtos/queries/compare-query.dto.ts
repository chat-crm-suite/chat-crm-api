import { createZodDto } from 'nestjs-zod';

import { CompareQuerySchema } from '../../../../contracts/index';

export class CompareQuery extends createZodDto(CompareQuerySchema) {}
