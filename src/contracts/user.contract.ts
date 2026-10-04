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
  firstName: z.string().optional(),
  lastName: z.string().optional(),
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

/**
 * Entity shape returned by the users endpoints (never includes `password`).
 * Used by `@ZodSerializerDto` on the API and by the frontend (dev-only parse).
 * `coerce.date` accepts both the entity `Date` and the ISO string over HTTP.
 */
export const UserResponseSchema = z.object({
  id: z.string(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  phoneNumber: z.string().nullish(),
  email: z.string().nullish(),
  username: z.string(),
  avatar: z.string().nullish(),
  address: z.string().nullish(),
  status: UserStatusSchema,
  role: UserRoleSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/** Subset returned by `GET /auth/me` (`UserRepository.findUserById`). */
export const AuthUserSchema = UserResponseSchema.pick({
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  address: true,
  avatar: true,
  email: true,
  phoneNumber: true,
  status: true,
  role: true,
});

export type UserRole = z.infer<typeof UserRoleSchema>;
export type UserStatus = z.infer<typeof UserStatusSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type UserSearchQueryInput = z.infer<typeof UserSearchQuerySchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
