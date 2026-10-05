import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';

import { ZodValidationExceptionFilter } from './zod-validation.filter';

type I18nLike = ConstructorParameters<typeof ZodValidationExceptionFilter>[0];

// Echoes key + args so the mapping (issue -> i18n key) is asserted directly.
const i18n = {
  t: (key: string, options?: { args?: Record<string, unknown> }) =>
    `${key}:${JSON.stringify(options?.args ?? {})}`,
} as unknown as I18nLike;

const createHost = () => {
  const response = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  return { host, response };
};

const filter = new ZodValidationExceptionFilter(i18n);

const parseError = (schema: z.ZodType, payload: unknown): z.ZodError => {
  const result = schema.safeParse(payload);

  if (result.success) throw new Error('payload should be invalid');

  return result.error;
};

describe('ZodValidationExceptionFilter', () => {
  it('keeps the legacy 400 envelope with translated messages', () => {
    const error = parseError(
      z.object({
        username: z.string().min(3),
        role: z.enum(['admin', 'agent']),
      }),
      { username: '', role: 'not-a-role' },
    );
    const { host, response } = createHost();

    filter.catch(new ZodValidationException(error), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.send).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: [
        'validations.min:{"attr":"username","min":3}',
        'validations.invalid.default:{"attr":"role"}',
      ],
      error: 'Bad Request',
    });
  });

  it('maps a missing field to the required message', () => {
    const error = parseError(z.object({ password: z.string().min(1) }), {});
    const { host, response } = createHost();

    filter.catch(new ZodValidationException(error), host);

    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: ['validations.required:{"attr":"password"}'],
      }),
    );
  });

  it('reports nested fields with their full path', () => {
    const error = parseError(
      z.object({ contact: z.object({ email: z.email() }) }),
      { contact: { email: 'not-an-email' } },
    );
    const { host, response } = createHost();

    filter.catch(new ZodValidationException(error), host);

    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: ['validations.invalid.default:{"attr":"contact.email"}'],
      }),
    );
  });
});
