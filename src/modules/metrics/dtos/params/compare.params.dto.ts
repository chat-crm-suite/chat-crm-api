import { createZodDto } from 'nestjs-zod';

import { CompareParamsSchema } from '../../../../contracts/index';

export class CompareParams extends createZodDto(CompareParamsSchema) {}
