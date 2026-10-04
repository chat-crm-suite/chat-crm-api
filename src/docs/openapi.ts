import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

/**
 * Swagger is served at `/docs` (and the JSON document at `/docs-json`).
 * Enabled when `SWAGGER_ENABLED=true`, or by default outside production.
 */
export const isSwaggerEnabled = (): boolean =>
  process.env.SWAGGER_ENABLED === 'true' ||
  (process.env.SWAGGER_ENABLED !== 'false' &&
    process.env.NODE_ENV !== 'production');

/**
 * Builds the OpenAPI document. Zod DTOs (`createZodDto`) contribute their JSON
 * Schema automatically; `cleanupOpenApiDoc` fixes the zod-generated parts.
 * Shared by the HTTP bootstrap and by `pnpm run docs:gen` / `docs:check`.
 */
export const buildOpenApiDocument = (app: INestApplication) => {
  const config = new DocumentBuilder()
    .setTitle('chat-crm API')
    .setDescription(
      'REST API for chat-crm. Generated from the code: Zod DTOs are the single ' +
        'source of truth for validation, types and this documentation.',
    )
    .setVersion('1.0')
    .addCookieAuth(
      'access_token',
      {
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
      },
      'access_token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  return cleanupOpenApiDoc(document);
};

export const setupSwagger = (app: INestApplication): void => {
  if (!isSwaggerEnabled()) return;

  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
};
