// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createZodDto } from 'nestjs-zod';

import {
  AuthUserSchema,
  AvatarUploadResultSchema,
  ChangePasswordSchema,
  UpdateProfileSchema,
} from '@contracts';

export class AuthUserResponseDto extends createZodDto(AuthUserSchema) {}
export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}
export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
export class AvatarUploadResultDto extends createZodDto(AvatarUploadResultSchema) {}
