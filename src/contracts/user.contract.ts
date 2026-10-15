// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import { MemberSummarySchema } from './member.contract';

/**
 * User contracts (v2).
 *
 * `users` is identity/login only: no role and no presence status. The role a
 * user has in each company comes from `company_members` (member.contract);
 * realtime presence lives in Redis.
 */

/** `role` is managed through company memberships, never at sign-up. */
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
  avatarUrl: z.string().optional(),
  password: z.string().min(8),
});

export const UpdateUserSchema = CreateUserSchema.partial();

export const UserSearchQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).default(10),
});

/**
 * Entity shape returned by the users endpoints (never includes `password`).
 * Used by `@ZodSerializerDto` on the API and by the frontend (dev-only parse).
 */
export const UserResponseSchema = z.object({
  id: z.string(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  phoneNumber: z.string().nullish(),
  email: z.string().nullish(),
  username: z.string(),
  avatarUrl: z.string().nullish(),
  isPlatformAdmin: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/** Subset returned by `GET /auth/me`, plus the company memberships. */
export const AuthUserSchema = UserResponseSchema.pick({
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  email: true,
  phoneNumber: true,
  isPlatformAdmin: true,
}).extend({
  memberships: z.array(MemberSummarySchema),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type UserSearchQueryInput = z.infer<typeof UserSearchQuerySchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;

/** `PATCH /users/me`. Username and platform flag are never editable here. */
export const UpdateProfileSchema = z.object({
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  phoneNumber: z.string().max(20).optional(),
  email: z.email().max(255).optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

/** `POST /users/me/password`. */
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/** `POST /users/me/avatar` (multipart `file`, image, max 2 MB). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AvatarUploadResultSchema = z.object({ avatarUrl: z.string() });
export type AvatarUploadResult = z.infer<typeof AvatarUploadResultSchema>;
