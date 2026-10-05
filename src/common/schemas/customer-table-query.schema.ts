import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { dataTableBaseSchema } from "./data-table-base.schema";

const customerFiltersShape = {
  displayName: z.string().optional(),
  phoneNumber: z.string().optional(),
  email: z.string().optional(),
  pipelineStageId: z.string().optional(),
  createdAt: z.string().optional(),
};

export const customerTableQuerySchema = dataTableBaseSchema.extend(customerFiltersShape);

/** Plain type (services/helpers) — object-literal types keep the index signature. */
export type CustomerTableQuery = z.infer<typeof customerTableQuerySchema>;

/** Validation carrier for `@Body()` (global ZodValidationPipe). */
export class CustomerTableQueryDto extends createZodDto(customerTableQuerySchema) {}
