import { Readable } from 'stream';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { CsvParser } from 'nest-csv-parser';
import { I18nService } from 'nestjs-i18n';
import { PinoLogger } from 'nestjs-pino';
import { paginate, Pagination } from 'nestjs-typeorm-paginate';
import { FindManyOptions, IsNull, Like, Repository } from 'typeorm';
import { UpdateResult } from 'typeorm/browser';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserSearchDto } from './dto/user-search.dto';
import type { UserTableQuery } from '../../common/schemas/user-table-query.schema';
import { buildQueryOptions } from '../../lib/helpers/build-query-options.helper';
import { Chat } from '../chats/entities/index';
import { User } from './entities/user.entity';
import { CoreService } from '../../core/core.service';
import { AuthUser } from '../../auth/index';
import { ClsService } from 'nestjs-cls';
import { UserRepository } from './user.repository';

@Injectable()
export class UsersService extends CoreService<User> {
  constructor(
    @InjectRepository(User)
    // This will be removed in the future
    private readonly repo: Repository<User>,
    private readonly UserRepo: UserRepository,
    @InjectRepository(Chat)
    private readonly chatRepo: Repository<Chat>,
    private readonly logger: PinoLogger,
    private readonly csv: CsvParser,
    private readonly cls: ClsService,
    private readonly i18n: I18nService,
  ) { super(repo) }

  private get userId() {
    return this.cls.get<string>('user-id');
  }

  async identify(): Promise<AuthUser | null> {
    return this.UserRepo.findUserById(this.userId);
  }

  async importCsv(file: Express.Multer.File, companyId?: string): Promise<{ count: number }> {
    const stream = Readable.from(file.buffer);
    const parsed = await this.csv.parse(stream, CreateUserDto, undefined, undefined, {
      strict: true,
      separator: ',',
    });

    const users = await Promise.all(
      parsed.list.map(async (row: Partial<User>) => ({
        username: row.username,
        firstNames: row.firstName,
        lastNames: row.lastName,
        phoneNumber: row.phoneNumber,
        email: row.email,
        password: await bcrypt.hash(row.password ?? 'password', 10),
        company: { id: companyId },
      }))
    );

    await this.repo.insert(users);

    return { count: users.length };
  }

  async online(id: string) {
    const result = await this.repo.update({ id }, { status: 'online' })
    return result.affected === 1;
  }

  async offline(id: string) {
    const result = await this.repo.update({ id }, { status: 'offline' })
    return result.affected === 1;
  }

  async table(query: UserTableQuery): Promise<Pagination<User>> {
    const { findOptions, paginationOptions } = buildQueryOptions<User>(query);

    const defaultFindOptions: FindManyOptions<User> = {
      where: { deletedAt: IsNull() },
      order: { status: 'DESC', updatedAt: 'DESC' },
    };

    const mergedFindOptions: FindManyOptions<User> = {
      ...defaultFindOptions,
      ...findOptions,
      where: { ...defaultFindOptions.where, ...findOptions.where },
      order: { ...defaultFindOptions.order, ...findOptions.order },
    };

    return paginate<User>(
      this.repo,
      paginationOptions,
      mergedFindOptions,
    );
  }

  // TODO: Using CoreService in this
  override async create(dto: CreateUserDto): Promise<User> {
    await this.assertUsernameAvailable(dto.username);

    const user = this.repo.create(dto);

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
      where: q ? [
        { username: Like(`%${q}%`) },
        { firstName: Like(`%${q}%`) },
        { lastName: Like(`%${q}%`) },
      ] : {},
      take: limit,
      order: { username: 'ASC' }
    };

    return this.repo.find(findOptions);
  }

  findOne(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  // async findAvailableAgent(companyId: string): Promise<User> {
  //   const agents = await this.repo.find({
  //     where: {
  //       status: 'online',
  //     },
  //     order: {
  //       status: 'DESC',
  //       username: 'ASC'
  //     },
  //     relations: ['company'],
  //   });

  //   if (agents.length === 0) {
  //     return this.findOrCreateSystemUser(companyId);
  //   }

  //   const agentsWithLoad = await Promise.all(
  //     agents.map(async (agent) => {
  //       const activeChats = await this.chatRepo.count({
  //         where: { assignedAgent: { id: agent.id }, status: ChatStatus.OPEN },
  //       });
  //       return { agent, activeChats };
  //     }),
  //   );

  //   agentsWithLoad.sort((a, b) => a.activeChats - b.activeChats);
  //   const bestAgent = agentsWithLoad[0].agent;

  //   this.logger.debug(`Selected agent ${bestAgent.username}`);
  //   return bestAgent;
  // }

  async getAgent() {
    const agent = await this.repo.findOne({ where: { status: 'online' } });
    if (agent) return agent;
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
      ...(password ? { password: bcrypt.hashSync(password, 10) } : {}),
    });
  }

  async remove(id: string): Promise<void> {
    await this.repo.softDelete({ id });
  }
}
