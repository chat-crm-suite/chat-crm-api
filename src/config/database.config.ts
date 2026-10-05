import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

import * as entityExports from '../entities/index';

/**
 * sqlite cannot AUTOINCREMENT a bigint PK, so `message_status_events` (the
 * append-only ticks table, MySQL-only) is excluded from the sqlite schema.
 * Everything else is shared.
 */
const sqliteEntities = Object.values(entityExports).filter(
  (candidate) =>
    typeof candidate === 'function' &&
    candidate.name !== 'MessageStatusEvent',
) as unknown as Function[];

export const mysqlDatabaseConfig: TypeOrmModuleOptions = {
  type: 'mysql',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: [
    __dirname + '/../modules/**/*.entity{.ts,.js}',
    __dirname + '/../integrations/**/*.entity{.ts,.js}'
  ],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  // Schema comes from migrations in every environment (dev and prod); the
  // `synchronize` shortcut is deliberately left to test configurations only.
  // Pending migrations are applied on every boot so the database is never empty.
  synchronize: false,
  migrationsRun: true,
  namingStrategy: new SnakeNamingStrategy(),
  // logging: ['query'],
  cache: {
    type: 'ioredis',
    duration: 60_000,
    options: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    },
  }
};

export const testDatabaseConfig: TypeOrmModuleOptions = {
  ...mysqlDatabaseConfig,
  database: process.env.DB_DATABASE + '_test',
  synchronize: true,
  migrationsRun: false,
  dropSchema: true,
  logger: 'formatted-console',
}

export const testDatabaseSQLiteConfig: TypeOrmModuleOptions = {
  type: 'better-sqlite3',
  database: ':memory:',
  synchronize: true,
  dropSchema: true,
  entities: sqliteEntities,
  migrations: [__dirname + '/../migrations/*.ts'],
  namingStrategy: new SnakeNamingStrategy(),
  logger: 'formatted-console'
}

/**
 * Runtime configuration used by the application.
 *
 * `DB_DRIVER=sqlite` swaps MySQL for in-memory SQLite so tooling (OpenAPI
 * generation: `pnpm run docs:gen|docs:check`) can boot the whole app without
 * infrastructure. Never use it in production: the Docker env files do not
 * define it.
 */
export const databaseConfig: TypeOrmModuleOptions =
  process.env.DB_DRIVER === 'sqlite'
    ? { ...testDatabaseSQLiteConfig, logger: undefined }
    : mysqlDatabaseConfig;