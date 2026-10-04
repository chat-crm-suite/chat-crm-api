import { z } from 'zod';

/**
 * User contracts (CRUD payloads + search).
 */
export const USER_ROLES = [
  'admin',
  'supervisor',
  'support',
  'agent',
  'system',
] as const;

export const UserRoleSchema = z.enum(USER_ROLES);

export const USER_STATUSES = ['online', 'offline', 'busy'] as const;

export const UserStatusSchema = z.enum(USER_STATUSES);

export const CreateUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  firstNames: z.string().optional(),
  lastNames: z.string().optional(),
  phoneNumber: z.string().optional(),
  email: z.email().optional(),
  avatar: z.string().optional(),
  address: z.string().optional(),
  password: z.string().min(8),
});

/**
 * `role` is only accepted on update (no self-escalation at sign-up).
 */
export const UpdateUserSchema = CreateUserSchema.partial().extend({
  role: UserRoleSchema.optional(),
});

export const UserSearchQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).default(10),
});

export type UserRole = z.infer<typeof UserRoleSchema>;
export type UserStatus = z.infer<typeof UserStatusSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type UserSearchQueryInput = z.infer<typeof UserSearchQuerySchema>;
