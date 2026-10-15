// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { memoryStorage } from 'multer';
import { ZodSerializerDto } from 'nestjs-zod';

import {
  AuthUserSchema,
  AvatarUploadResultSchema,
  AVATAR_MAX_BYTES,
} from '../../contracts/index';
import {
  AuthUserResponseDto,
  AvatarUploadResultDto,
  UpdateProfileDto,
} from './dto/profile.dto';
import { UsersService } from './users.service';
import { UserScoped } from '@auth';

/**
 * The session user's own account. There is no user directory or CRUD here:
 * people join a company through its team (`/company-members`) or the platform
 * console, and edit only themselves through `me`.
 */
@ApiTags('Users')
@ApiCookieAuth('access_token')
@UserScoped()
@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) { }

  @Get('me')
  @ZodSerializerDto(AuthUserSchema.nullable())
  me() {
    return this.service.identify();
  }

  @Patch('me')
  @ApiOperation({ summary: 'Edit my names, phone and email' })
  @ZodSerializerDto(AuthUserSchema.nullable())
  @ApiOkResponse({ type: AuthUserResponseDto })
  updateMe(@Body() dto: UpdateProfileDto) {
    return this.service.updateProfile(dto);
  }

  @Post('me/avatar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload my avatar (JPEG, PNG or WebP, up to 2 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
    }),
  )
  @ZodSerializerDto(AvatarUploadResultSchema)
  @ApiOkResponse({ type: AvatarUploadResultDto })
  uploadAvatar(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.service.saveAvatar(file);
  }

  /** Any signed-in user may load an avatar (teammates show up in lists). */
  @Get(':id/avatar')
  @ApiOperation({ summary: 'Avatar image of a user' })
  async avatar(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const avatar = await this.service.findAvatar(id);
    if (!avatar) throw new NotFoundException('Avatar not found');

    res.setHeader('Content-Type', avatar.mime);
    res.setHeader('Content-Length', String(avatar.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The `?v=` of the stored url changes on every upload, busting this cache.
    res.setHeader('Cache-Control', 'private, max-age=86400');

    createReadStream(avatar.path).pipe(res);
  }
}
