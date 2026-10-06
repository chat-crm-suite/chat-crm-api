// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { DataSource } from "typeorm"
import { SnakeNamingStrategy } from "typeorm-naming-strategies";

export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  namingStrategy: new SnakeNamingStrategy(),
  entities: [
    __dirname + '/src/modules/**/*.entity{.ts,.js}',
    __dirname + '/src/integrations/**/*.entity{.ts,.js}',
  ],
  migrations: [__dirname + '/src/migrations/*{.ts,.js}'],
  migrationsTableName: "migrations",
  synchronize: false,
  migrationsRun: process.env.NODE_ENV === 'production',
})