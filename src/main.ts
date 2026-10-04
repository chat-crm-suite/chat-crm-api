import { NestFactory, Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import {
  I18nService,
  I18nValidationExceptionFilter,
  I18nValidationPipe,
} from 'nestjs-i18n';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';

import { AppModule } from './app.module';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { ZodValidationExceptionFilter } from './common/filters/zod-validation.filter';
import { setupSwagger } from './docs/openapi';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Logger nest-pino
  app.useLogger(app.get(Logger));

  // I18n validations: class-validator DTOs use the i18n pipe; Zod DTOs throw
  // ZodValidationException and are rendered by ZodValidationExceptionFilter
  // with the same envelope. The i18n pipe is removed once every DTO is Zod.
  app.useGlobalPipes(new I18nValidationPipe());
  app.useGlobalFilters(
    new I18nValidationExceptionFilter({
      detailedErrors: false,
    }),
    new ZodValidationExceptionFilter(app.get(I18nService)),
  );

  // OpenAPI docs (/docs) — disabled in production unless SWAGGER_ENABLED=true
  setupSwagger(app);

  // Interceptors
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
    new LoggerErrorInterceptor(),
  );

  // Authentication
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
