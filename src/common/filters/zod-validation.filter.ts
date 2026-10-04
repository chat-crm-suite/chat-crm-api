import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { I18nService } from 'nestjs-i18n';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError, ZodIssue } from 'zod';

/**
 * Renders `ZodValidationException` with the same response envelope the API
 * used before (class-validator + `I18nValidationExceptionFilter`):
 *
 * ```json
 * { "statusCode": 400, "message": ["<translated message>"], "error": "Bad Request" }
 * ```
 *
 * Messages are translated with the `validations.*` keys from
 * `src/locales/es/validations.yml`, so the frontend keeps showing Spanish
 * texts without any change.
 */
@Catch(ZodValidationException)
export class ZodValidationExceptionFilter implements ExceptionFilter {
  constructor(private readonly i18n: I18nService) {}

  catch(exception: ZodValidationException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const error = exception.getZodError() as ZodError;
    const message = error.issues.map((issue) => this.translate(issue));

    response.status(HttpStatus.BAD_REQUEST).send({
      statusCode: HttpStatus.BAD_REQUEST,
      message,
      error: 'Bad Request',
    });
  }

  private translate(issue: ZodIssue): string {
    const attr = issue.path.map(String).join('.') || 'body';

    switch (issue.code) {
      case 'invalid_type':
        return issue.input === undefined
          ? this.i18n.t('validations.required', { args: { attr } })
          : this.i18n.t('validations.invalid.default', { args: { attr } });
      case 'too_small':
        return issue.origin === 'string'
          ? this.i18n.t('validations.min', {
              args: { attr, min: issue.minimum },
            })
          : this.i18n.t('validations.invalid.default', { args: { attr } });
      default:
        return this.i18n.t('validations.invalid.default', { args: { attr } });
    }
  }
}
