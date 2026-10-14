// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { rm } from 'node:fs/promises';
import { finalize, type Observable } from 'rxjs';

/**
 * Deletes the temp file multer wrote once the request ends, whatever the
 * outcome. Declare it after `FileInterceptor`: it then wraps validation,
 * guards' follow-ups and the handler, so a refused upload never leaves a
 * file behind (a staged one was already moved away).
 */
@Injectable()
export class RemoveUploadedFileInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      finalize(() => {
        const path = request.file?.path;
        if (path) void rm(path, { force: true });
      }),
    );
  }
}
