// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get, Headers, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';

import { CurrentUser, Public, UserScoped } from '@auth';
import type { JwtPayload } from '@auth/auth.types';
import { COMPANY_HEADER } from '../../contracts/index';
import type { AttachmentGrant } from './attachment-signature.service';
import {
  AttachmentsService,
  type ResolvedAttachment,
} from './attachments.service';

/**
 * T25 private attachments endpoint.
 *
 * `/attachments/:id` streams media from company-scoped private storage. It is
 * user-scoped (no `x-company-id` needed, so plain `<img>`/`<audio>` tags work):
 * the company comes from the attachment and must be one of the session's
 * memberships, then the same role rules as the socket room join apply; a
 * leaked URL without a session is rejected. `/attachments/:id/signed` serves
 * a direct-from-storage URL and requires an unexpired short-lived signature
 * instead of a session.
 */
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @UserScoped()
  @Get(':attachmentId')
  async download(
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: JwtPayload,
    @Headers(COMPANY_HEADER) requestedCompanyId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const resolved = await this.attachments.authorizeForSession(
      attachmentId,
      user,
      requestedCompanyId,
    );

    this.stream(res, resolved);
  }

  @Public()
  @Get(':attachmentId/signed')
  async downloadSigned(
    @Param('attachmentId') attachmentId: string,
    @Query('expires') expires: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const grant: AttachmentGrant = { expires: expires ?? '', sig: sig ?? '' };
    const resolved = await this.attachments.authorizeSigned(
      attachmentId,
      grant,
    );

    this.stream(res, resolved);
  }

  private stream(res: Response, resolved: ResolvedAttachment): void {
    // Media is user-scoped and must not be cached by shared proxies.
    res.setHeader('Content-Type', resolved.mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    if (resolved.attachment.sizeBytes != null) {
      res.setHeader('Content-Length', String(resolved.attachment.sizeBytes));
    }

    createReadStream(resolved.absolutePath).pipe(res);
  }
}
