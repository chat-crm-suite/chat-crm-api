// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Readable } from 'stream';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { CsvParser } from 'nest-csv-parser';
import { I18nService } from 'nestjs-i18n';
import { PinoLogger } from 'nestjs-pino';
import { paginate, Pagination } from 'nestjs-typeorm-paginate';
import {
  FindManyOptions,
  IsNull,
  Like,
  Repository,
  UpdateResult,
} from 'typeorm';
import { ClsService } from 'nestjs-cls';

import type { AuthUser } from '../../contracts/index';
import { buildQueryOptions } from '../../lib/helpers/build-query-options.helper';
import type { UserTableQuery } from '../../common/schemas/user-table-query.schema';
import { CoreService } from '../../core/core.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserSearchDto } from './dto/user-search.dto';
import { User } from './entities/user.entity';
import { UserRepository } from './user.repository';

@Injectable()
export class UsersService extends CoreService<User> {
  constructor(
    @InjectRepository(User)
    // This will be removed in the future
    private readonly repo: Repository<User>,
    private readonly UserRepo: UserRepository,
    private readonly logger: PinoLogger,
    private readonly csv: CsvParser,
    private readonly cls: ClsService,
    private readonly i18n: I18nService,
  ) {
    super(repo);
  }

  private get userId() {
    return this.cls.get<string>('user-id');
  }

  async identify(): Promise<AuthUser | null> {
    return this.UserRepo.findUserById(this.userId);
  }

  async importCsv(file: Express.Multer.File): Promise<{ count: number }> {
    const stream = Readable.from(file.buffer);
    const parsed = await this.csv.parse(
      stream,
      CreateUserDto,
      undefined,
      undefined,
      {
        strict: true,
        separator: ',',
      },
    );

    const users = await Promise.all(
      parsed.list.map(
        async (row: Partial<User> & { password?: string }) => ({
          username: row.username,
          firstName: row.firstName,
          lastName: row.lastName,
          phoneNumber: row.phoneNumber,
          email: row.email,
          passwordHash: await bcrypt.hash(row.password ?? 'password', 10),
        }),
      ),
    );

    await this.repo.insert(users);

    return { count: users.length };
  }

  async table(query: UserTableQuery): Promise<Pagination<User>> {
    const { findOptions, paginationOptions } = buildQueryOptions<User>(query);

    const defaultFindOptions: FindManyOptions<User> = {
      where: { deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    };

    const mergedFindOptions: FindManyOptions<User> = {
      ...defaultFindOptions,
      ...findOptions,
      where: { ...defaultFindOptions.where, ...findOptions.where },
      order: { ...defaultFindOptions.order, ...findOptions.order },
    };

    return paginate<User>(this.repo, paginationOptions, mergedFindOptions);
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

  searchUser(dto: UserSearchDto) {
    const { q, limit } = dto;
    const findOptions: FindManyOptions<User> = {
      where: q
        ? [
            { username: Like(`%${q}%`) },
            { firstName: Like(`%${q}%`) },
            { lastName: Like(`%${q}%`) },
          ]
        : {},
      take: limit,
      order: { username: 'ASC' },
    };

    return this.repo.find(findOptions);
  }

  findOne(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  // TODO: Using CoreService in this
  override async update(id: string, dto: UpdateUserDto): Promise<UpdateResult> {
    const { password, ...rest } = dto;

    if (dto.username) {
      // `id` is ignored so keeping the current username is not a conflict.
      await this.assertUsernameAvailable(dto.username, id);
    }

    return this.repo.update(id, {
      ...rest,
      // Solo se regenera el hash si el DTO trae password; si no, no se toca.
      ...(password ? { passwordHash: bcrypt.hashSync(password, 10) } : {}),
    });
  }

  async remove(id: string): Promise<void> {
    await this.repo.softDelete({ id });
  }
}
