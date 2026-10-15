// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  BadRequestException,
  ConflictException,
  Injectable,
  PayloadTooLargeException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { I18nService } from 'nestjs-i18n';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';

import {
  AVATAR_MAX_BYTES,
  type AuthUser,
  type AvatarUploadResult,
  type ChangePasswordInput,
  type UpdateProfileInput,
} from '../../contracts/index';
import { CLS_USER_ID } from '../../config/cls.keys';
import { SessionRevocationService } from '../../auth/session/session-revocation.service';
import { CoreService } from '../../core/core.service';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from './entities/user.entity';
import { AvatarStorageService, sniffAvatarMime } from './avatar-storage.service';
import { UserRepository } from './user.repository';

const isUniqueViolation = (error: unknown): boolean => {
  const code =
    (error as { code?: string })?.code ??
    (error as { driverError?: { code?: string } })?.driverError?.code;

  return code === 'ER_DUP_ENTRY' || code === 'SQLITE_CONSTRAINT_UNIQUE';
};

@Injectable()
export class UsersService extends CoreService<User> {
  constructor(
    @InjectRepository(User)
    // This will be removed in the future
    private readonly repo: Repository<User>,
    private readonly UserRepo: UserRepository,
    private readonly logger: PinoLogger,
    private readonly cls: ClsService,
    private readonly i18n: I18nService,
    private readonly sessions: SessionRevocationService,
    private readonly avatars: AvatarStorageService,
  ) {
    super(repo);
  }

  private get userId() {
    return this.cls.get<string>(CLS_USER_ID);
  }

  private requireUserId(): string {
    const userId = this.userId;
    if (!userId) throw new UnauthorizedException();

    return userId;
  }

  /** Profile + memberships of the session user. */
  async identify(): Promise<AuthUser | null> {
    return this.profile(this.userId);
  }

  /** Profile + memberships of a given user (`/auth/me` shape). */
  async profile(userId: string | undefined): Promise<AuthUser | null> {
    if (!userId) return null;

    return this.UserRepo.findUserById(userId);
  }

  /**
   * Edits the session user's own contact data. Only the fields of
   * `UpdateProfileSchema` are ever written (never username, password or the
   * platform flag); an empty name or phone clears it. An email or phone that
   * belongs to another account is a conflict.
   */
  async updateProfile(dto: UpdateProfileInput): Promise<AuthUser | null> {
    const userId = this.requireUserId();

    const patch: Record<string, string | null> = {};
    if (dto.firstName !== undefined) patch.firstName = dto.firstName || null;
    if (dto.lastName !== undefined) patch.lastName = dto.lastName || null;
    if (dto.phoneNumber !== undefined) patch.phoneNumber = dto.phoneNumber || null;
    if (dto.email !== undefined) patch.email = dto.email.trim().toLowerCase();

    if (patch.email) await this.assertFree('email', patch.email, userId);
    if (patch.phoneNumber) await this.assertFree('phoneNumber', patch.phoneNumber, userId);

    if (Object.keys(patch).length) {
      try {
        await this.repo.update(userId, patch);
      } catch (error) {
        // The unique index is the race-safe guarantee behind the checks above.
        if (isUniqueViolation(error)) {
          throw new ConflictException({
            code: 'contact_taken',
            message: 'That email or phone number belongs to another account',
          });
        }
        throw error;
      }
    }

    return this.profile(userId);
  }

  /**
   * Changes the session user's password after checking the current one, and
   * revokes every session. The caller must then issue a fresh token for the
   * request that made the change, so that one stays logged in.
   */
  async changePassword(dto: ChangePasswordInput): Promise<void> {
    const userId = this.requireUserId();

    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException({
        code: 'invalid_current_password',
        message: 'The current password is not correct',
      });
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException({
        code: 'password_unchanged',
        message: 'The new password must differ from the current one',
      });
    }

    await this.repo.update(userId, {
      passwordHash: await bcrypt.hash(dto.newPassword, 10),
    });
    await this.sessions.revoke(userId);
  }

  /**
   * Stores the uploaded image as the session user's avatar. The type comes
   * from the file's first bytes (jpeg, png, webp), never from the client
   * mime; the browser already resized it, so there is no image processing.
   */
  async saveAvatar(file: Pick<Express.Multer.File, 'buffer' | 'size'> | undefined): Promise<AvatarUploadResult> {
    const userId = this.requireUserId();
    if (!file?.buffer?.length) throw new BadRequestException('A file is required');
    if (file.buffer.length > AVATAR_MAX_BYTES) {
      throw new PayloadTooLargeException('The image exceeds the 2 MB limit');
    }

    const mime = sniffAvatarMime(file.buffer);
    if (!mime) {
      throw new UnsupportedMediaTypeException('Only JPEG, PNG or WebP images are accepted');
    }

    await this.avatars.save(userId, mime, file.buffer);

    // The version busts the one-day private cache of the avatar endpoint.
    const avatarUrl = `/users/${userId}/avatar?v=${Date.now()}`;
    await this.repo.update(userId, { avatarUrl });

    return { avatarUrl };
  }

  /** The stored avatar of a user, or `null` when there is none. */
  findAvatar(userId: string) {
    return this.avatars.find(userId);
  }

  // TODO: Using CoreService in this
  override async create(dto: CreateUserDto): Promise<User> {
    await this.assertUsernameAvailable(dto.username);

    const { password, ...rest } = dto;
    const user = this.repo.create({
      ...rest,
      passwordHash: await bcrypt.hash(password, 10),
    });

    return this.repo.save(user);
  }

  /**
   * Uniqueness lives here (not in the schema): the database unique index is the
   * race-safe guarantee, this check only produces the translated 400 message.
   */
  private async assertUsernameAvailable(
    username: string,
    ignoreUserId?: string,
  ): Promise<void> {
    const existing = await this.repo.findOne({ where: { username } });

    if (existing && existing.id !== ignoreUserId) {
      throw new BadRequestException(
        this.i18n.t('validations.unique', { args: { field: 'username' } }),
      );
    }
  }

  /** Soft-deleted accounts keep their unique values, so they count as taken. */
  private async assertFree(
    field: 'email' | 'phoneNumber',
    value: string,
    ignoreUserId: string,
  ): Promise<void> {
    const existing = await this.repo.findOne({
      where: { [field]: value },
      withDeleted: true,
      select: { id: true },
    });

    if (existing && existing.id !== ignoreUserId) {
      throw new ConflictException({
        code: field === 'email' ? 'email_taken' : 'phone_taken',
        message:
          field === 'email'
            ? 'That email belongs to another account'
            : 'That phone number belongs to another account',
      });
    }
  }

  findOne(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }
}
