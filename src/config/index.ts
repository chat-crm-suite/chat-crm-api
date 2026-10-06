// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';

import { CacheModule } from '@nestjs/cache-manager';
import { cacheConfig } from './cache.config';

import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './database.config';

import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from './logger.config';

import { I18nModule } from 'nestjs-i18n';
import { i18nConfig } from './i18n.config';

import { CqrsModule } from '@nestjs/cqrs'
import { cqrsConfig } from './cqrs.config';

import { BullModule } from '@nestjs/bullmq';
import { bullmqConfig } from './bullmq.config';
import { ClsModule } from 'nestjs-cls';
import { clsConfig } from './cls.config';

import { HealthModule } from '../modules/health/health.module';

const configs = [
  I18nModule.forRoot(i18nConfig),
  LoggerModule.forRoot(loggerConfig),
  TypeOrmModule.forRoot(databaseConfig),
  CacheModule.registerAsync(cacheConfig),
  BullModule.forRoot(bullmqConfig),
  ClsModule.forRoot(clsConfig),
  CqrsModule.forRoot(cqrsConfig),
  // El módulo de salud vive aquí porque consume estas configuraciones
  // (DataSource, CacheModule, BullModule) y así hay una sola fuente de ensamblaje.
  HealthModule,
]

@Module({
  imports: configs,
  exports: configs
}) export class AppConfigsModule { }