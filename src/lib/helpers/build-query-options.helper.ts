// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { IPaginationOptions } from 'nestjs-typeorm-paginate';
import { FindManyOptions, In, Between, Like, FindOptionsOrder } from 'typeorm';
import { TypeOrmQueryHelperInput } from '../../common/types/data-table.types';

const RESERVED_FIELDS = ['page', 'perPage', 'sort'];

const mapSortToTypeOrmOrder = (sort: TypeOrmQueryHelperInput['sort']) => {
  if (!sort || sort.length === 0) {
    return {};
  }

  return sort.reduce((acc, item) => {
    if (item?.id) {
      acc[item.id] = item.desc ? 'DESC' : 'ASC';
    }
    return acc;
  }, {});
};

export function buildQueryOptions<T extends { createdAt: Date }>(
  query: TypeOrmQueryHelperInput,
): { findOptions: FindManyOptions<T>; paginationOptions: IPaginationOptions } {

  const findOptions: FindManyOptions<T> = { where: {}, order: {} };

  const mappedOrder = mapSortToTypeOrmOrder(query.sort);

  findOptions.order = Object.keys(mappedOrder).length > 0
    ? mappedOrder
    : { createdAt: 'DESC' } as FindOptionsOrder<T>;

  for (const [key, value] of Object.entries(query)) {
    if (RESERVED_FIELDS.includes(key) || value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      (findOptions.where!)[key] = In(value);
      continue;
    }

    if (typeof value === 'string') {
      const isDateRange = (key.toLowerCase().includes('at') || key.toLowerCase().includes('date')) && value.includes(',');

      if (isDateRange) {
        const parts = value.split(',');
        if (parts.length === 2) {
          const startDate = new Date(parseInt(parts[0], 10));
          const endDate = new Date(parseInt(parts[1], 10));
          (findOptions.where!)[key] = Between(startDate, endDate);
          continue;
        }
      }

      (findOptions.where!)[key] = Like(`%${value}%`);
      continue;
    }
  }

  const paginationOptions: IPaginationOptions = {
    limit: query.perPage,
    page: query.page,
  };

  return { findOptions, paginationOptions };
}