// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  testDatabaseConfig,
  testDatabaseSQLiteConfig,
} from '../../src/config/database.config';

/**
 * MySQL `_test` config (dropSchema + synchronize). The ioredis query cache of
 * the runtime config is stripped: tests do not need it and it would keep
 * connections open after the DataSource is destroyed.
 */
export const getTestConfig = (
  entities: any[],
  opts?: TypeOrmModuleOptions,
): TypeOrmModuleOptions => {
  const { cache: _cache, ...baseConfig } = testDatabaseConfig;
  void _cache;

  return {
    ...baseConfig,
    entities,
    logging: false,
    ...opts,
  } as TypeOrmModuleOptions;
};

export const getTestSQLiteConfig = (
  entities: any[],
  extraOpts?: TypeOrmModuleOptions,
): TypeOrmModuleOptions => ({
  ...testDatabaseSQLiteConfig,
  entities,
  logging: false,
  ...extraOpts,
} as TypeOrmModuleOptions);

/**
 * Fast per-test cleanup for MySQL `_test`: empties every registered table
 * without the cost of a full drop/synchronize. Use only when the suite does
 * not run inside its own transaction.
 */
export const truncateAllTables = async (
  dataSource: DataSource,
): Promise<void> => {
  const tables = dataSource.entityMetadatas.map((meta) => meta.tableName);

  await dataSource.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of tables) {
      await dataSource.query(`TRUNCATE TABLE \`${table}\``);
    }
  } finally {
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 1');
  }
};
