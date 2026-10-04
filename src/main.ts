import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { I18nService } from 'nestjs-i18n';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';

import { AppModule } from './app.module';
import { ZodValidationExceptionFilter } from './common/filters/zod-validation.filter';
import { setupSwagger } from './docs/openapi';

async function bootstrap() {
  // Red de seguridad: un rechazo async no manejado (ej. jobs post-webhook)
  // debe quedar en logs, no tumbar el proceso como ocurrió con ER_DUP_ENTRY.
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });
  process.on('uncaughtException', (error) => {
    console.error('[uncaughtException]', error);
  });

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Logger nest-pino
  app.useLogger(app.get(Logger));

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
