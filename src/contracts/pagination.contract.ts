import { z } from 'zod';

/**
 * Pagination contract (nestjs-typeorm-paginate shape), reusable for any
 * paginated endpoint that needs serialization.
 */
export const PaginationMetaSchema = z.object({
  totalItems: z.number(),
  itemCount: z.number(),
  itemsPerPage: z.number(),
  totalPages: z.number(),
  currentPage: z.number(),
});

export const paginatedSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    meta: PaginationMetaSchema,
  });

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;
