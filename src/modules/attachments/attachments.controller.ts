// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { ClsService } from 'nestjs-cls';

import { CLS_COMPANY_ID, CLS_USER_ID } from '../../config/cls.keys';
import type { ConversationSocketIdentity } from '../conversations/realtime/conversation-access.service';
import type { AttachmentGrant } from './attachment-signature.service';
import {
  AttachmentsService,
  type ResolvedAttachment,
} from './attachments.service';

/**
 * T25 private attachments endpoint.
 *
 * `/attachments/:id` streams media from company-scoped private storage after
 * the same membership check as the socket room join; a leaked URL without a
 * session is rejected. `/attachments/:id/signed` serves a direct-from-storage
 * URL and requires an unexpired short-lived signature instead of a session.
 */
@Controller('attachments')
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly cls: ClsService,
  ) {}

  @Get(':attachmentId')
  @UseGuards(AuthGuard('jwt'))
  async download(
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const resolved = await this.attachments.authorizeForSession(
      attachmentId,
      this.identity(),
    );

    this.stream(res, resolved);
  }

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

  /** Verified HTTP identity: the JWT user plus the company request scope. */
  private identity(): ConversationSocketIdentity {
    return {
      userId: this.cls.get<string>(CLS_USER_ID) ?? null,
      companyId: this.cls.get<string>(CLS_COMPANY_ID) ?? null,
      authenticated: true,
    };
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
