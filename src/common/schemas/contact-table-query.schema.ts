import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { dataTableBaseSchema } from "./data-table-base.schema";

const contactFiltersShape = {
  username: z.string().optional(),
  phoneNumber: z.string().optional(),
  status: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
};

export const contactTableQuerySchema = dataTableBaseSchema.extend(contactFiltersShape);

/** Plain type (services/helpers) — object-literal types keep the index signature. */
export type ContactTableQuery = z.infer<typeof contactTableQuerySchema>;

/** Validation carrier for `@Body()` (global ZodValidationPipe). */
export class ContactTableQueryDto extends createZodDto(contactTableQuerySchema) {}
