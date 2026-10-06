// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Readable } from 'stream';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CsvParser } from 'nest-csv-parser';
import { ClsService } from 'nestjs-cls';
import { paginate, Pagination } from 'nestjs-typeorm-paginate';
import {
  FindManyOptions,
  IsNull,
  Like,
  Repository,
  UpdateResult,
} from 'typeorm';

import type { CustomerTableQuery } from '../../common/schemas/customer-table-query.schema';
import { buildQueryOptions } from '../../lib/helpers/build-query-options.helper';
import {
  isDuplicateEntryError,
  normalizePhoneNumber,
} from '../../lib/helpers/phone.helper';
import { CreateCustomerDto } from './dto/customer.dto';
import { UpdateCustomerDto } from './dto/customer.dto';
import { Customer } from './entities/customer.entity';
import { CustomerIdentity } from './entities/customer-identity.entity';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(CustomerIdentity)
    private readonly identities: Repository<CustomerIdentity>,
    private readonly csv: CsvParser,
    private readonly cls: ClsService,
  ) {}

  private get companyId(): string {
    return this.cls.get('company.id');
  }

  async importCsv(file: Express.Multer.File): Promise<{ count: number }> {
    if (!this.companyId) {
      throw new BadRequestException('Company context required');
    }

    const stream = Readable.from(file.buffer);
    const parsed = await this.csv.parse(
      stream,
      CreateCustomerDto,
      undefined,
      undefined,
      {
        strict: true,
        separator: ',',
      },
    );

    const rows = parsed.list.map(
      (row: { displayName?: string; phoneNumber?: string; email?: string }) => ({
        companyId: this.companyId,
        displayName: row.displayName,
        phoneNumber: row.phoneNumber
          ? normalizePhoneNumber(row.phoneNumber)
          : undefined,
        email: row.email,
        source: 'import' as const,
      }),
    );

    if (rows.length) {
      await this.customers
        .createQueryBuilder()
        .insert()
        .values(rows)
        .orIgnore()
        .execute();
    }

    return { count: rows.length };
  }

  async table(query: CustomerTableQuery): Promise<Pagination<Customer>> {
    const { findOptions, paginationOptions } = buildQueryOptions<Customer>(query);

    const defaultFindOptions: FindManyOptions<Customer> = {
      where: { deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    };

    const mergedFindOptions: FindManyOptions<Customer> = {
      ...defaultFindOptions,
      ...findOptions,
      where: { ...defaultFindOptions.where, ...findOptions.where },
      order: { ...defaultFindOptions.order, ...findOptions.order },
    };

    return paginate<Customer>(this.customers, paginationOptions, mergedFindOptions);
  }

  async search(q: string = '', limit: number = 10): Promise<Customer[]> {
    const findOptions: FindManyOptions<Customer> = {
      where: [
        { displayName: Like(`%${q}%`) },
        { firstName: Like(`%${q}%`) },
        { lastName: Like(`%${q}%`) },
        { phoneNumber: Like(`%${q}%`) },
        { email: Like(`%${q}%`) },
      ],
      take: limit,
      order: { displayName: 'ASC' },
    };

    return this.customers.find(findOptions);
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const customer = this.customers.create({
      ...dto,
      companyId: this.companyId,
      phoneNumber: dto.phoneNumber
        ? normalizePhoneNumber(dto.phoneNumber)
        : undefined,
    });

    return this.customers.save(customer);
  }

  async findAll() {
    return this.customers.find();
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<UpdateResult> {
    return await this.customers.update(id, {
      ...dto,
      ...(dto.phoneNumber
        ? { phoneNumber: normalizePhoneNumber(dto.phoneNumber) }
        : {}),
    });
  }

  async remove(id: string) {
    const res = await this.customers.softDelete({ id });

    if (res.affected === 0) {
      throw new NotFoundException(`Cliente con id ${id} no encontrado`);
    }

    return { success: true, id };
  }

  /**
   * Resolution canon (docs/database/README.md — Identity canon): the webhook resolves a customer
   * through `customer_identities(channel_id, external_id)`. `external_id` is
   * stored raw; `phone_number` is normalized to `+digits` and is informational.
   * Concurrent duplicates are tolerated by re-reading after ER_DUP_ENTRY.
   */
  async findOrCreateIncoming(params: {
    companyId: string;
    channelId: string;
    externalId: string;
    phoneNumber?: string;
    profileName?: string;
  }): Promise<Customer> {
    const { companyId, channelId, externalId, profileName } = params;
    const phoneNumber = params.phoneNumber
      ? normalizePhoneNumber(params.phoneNumber)
      : undefined;

    const findIdentity = () =>
      this.identities.findOne({
        where: { channelId, externalId },
        relations: { customer: true },
      });

    let identity = await findIdentity();
    if (identity) {
      if (profileName && identity.profileName !== profileName) {
        await this.identities.update(identity.id, { profileName });
      }
      return identity.customer;
    }

    const findCustomer = () =>
      phoneNumber
        ? this.customers.findOne({ where: { companyId, phoneNumber } })
        : Promise.resolve(null);

    let customer = await findCustomer();

    if (!customer) {
      try {
        customer = await this.customers.save(
          this.customers.create({
            companyId,
            phoneNumber,
            displayName: profileName,
            source: 'whatsapp',
          }),
        );
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        customer = await findCustomer();
        if (!customer) throw error;
      }
    }

    try {
      await this.identities.save(
        this.identities.create({
          customerId: customer.id,
          channelId,
          externalId,
          profileName,
        }),
      );
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      identity = await findIdentity();
      if (identity) return identity.customer;
      throw error;
    }

    return customer;
  }

  findByPhone(phoneNumber: string): Promise<Customer | null> {
    return this.customers.findOne({
      where: { phoneNumber: normalizePhoneNumber(phoneNumber) },
    });
  }
}
