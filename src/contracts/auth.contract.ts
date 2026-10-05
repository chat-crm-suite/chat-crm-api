import { z } from 'zod';

/**
 * Auth contracts (login).
 *
 * NOTE: these schemas are the single source of truth for both sides:
 * - API: consumed through `createZodDto` (validation + Swagger schema).
 * - Frontend: consumed through the `@chat-crm/contracts` alias.
 * Keep them as portable TypeScript (only `zod` imports allowed).
 */
export const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const LoginResponseSchema = z.object({
  message: z.string(),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
