// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, EntityTarget, getMetadataArgsStorage } from 'typeorm';

import * as Entities from '@entities';
import { MessageStatusEvent } from '@modules/message/entities/message-status-event.entity';
import {
  testDatabaseConfig,
  testDatabaseSQLiteConfig,
} from '@config/database.config';

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

/**
 * Per-test cleanup for the in-memory sqlite config: empties every registered
 * table with foreign keys off (sqlite has no TRUNCATE).
 */
export const clearSQLiteTables = async (dataSource: DataSource): Promise<void> => {
  await dataSource.query('PRAGMA foreign_keys = OFF');
  try {
    for (const meta of dataSource.entityMetadatas) {
      await dataSource.query(`DELETE FROM "${meta.tableName}"`);
    }
  } finally {
    await dataSource.query('PRAGMA foreign_keys = ON');
  }
};

/**
 * Every entity, for the in-memory sqlite schema. sqlite only auto-increments
 * an INTEGER primary key, so the one bigint PK (`message_status_events`) is
 * declared as integer for this test process. Jest gives each test file its
 * own global context, so production metadata is never affected.
 */
export const getSQLiteEntities = (): EntityTarget<unknown>[] => {
  const id = getMetadataArgsStorage().columns.find(
    (column) =>
      column.target === MessageStatusEvent && column.propertyName === 'id',
  );
  if (id) id.options.type = 'integer';

  return Object.values(Entities);
};
