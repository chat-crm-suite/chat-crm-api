// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import cookieParser from 'cookie-parser';
import { I18nService } from 'nestjs-i18n';
import { Logger, LoggerErrorInterceptor, PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { ZodValidationExceptionFilter } from './common/filters/zod-validation.filter';
import { loggerConfig } from './config/logger.config';
import { RedisIoAdapter } from './config/setups/socket/redis-io.adapter';
import { setupSwagger } from './docs/openapi';
import { createNestApp } from './nest-app.factory';

async function bootstrap() {
  // Red de seguridad: un rechazo async no manejado (ej. jobs post-webhook)
  // debe quedar en logs, no tumbar el proceso como ocurrió con ER_DUP_ENTRY.
  // Usa el logger de la app (misma config, formato y niveles) desde el arranque.
  const safetyLogger = new PinoLogger(loggerConfig);
  safetyLogger.setContext('Bootstrap');

  process.on('unhandledRejection', (reason) => {
    safetyLogger.error(
      { err: reason },
      '[unhandledRejection] Unhandled rejection',
    );
  });
  process.on('uncaughtException', (error) => {
    safetyLogger.error({ err: error }, '[uncaughtException] Uncaught exception');
  });

  const app = await createNestApp(AppModule);

  // Logger nest-pino
  app.useLogger(app.get(Logger));

  // Socket.io rooms shared through Redis (multi-instance safe).
  const socketLogger = new PinoLogger(loggerConfig);
  socketLogger.setContext(RedisIoAdapter.name);
  const ioAdapter = new RedisIoAdapter(app, socketLogger);
  await ioAdapter.connectToRedis();
  app.useWebSocketAdapter(ioAdapter);

  // Validation errors (Zod DTOs) keep the legacy 400 envelope with the
  // `validations.*` i18n keys.
  app.useGlobalFilters(new ZodValidationExceptionFilter(app.get(I18nService)));

  // OpenAPI docs (/docs) — disabled in production unless SWAGGER_ENABLED=true
  setupSwagger(app);

  // Interceptors
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  // Authentication
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
