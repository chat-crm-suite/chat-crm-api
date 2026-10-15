// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Reflector } from '@nestjs/core';
import type { Response } from 'express';

import type { JwtPayload } from '@auth/auth.types';
import {
  IS_PUBLIC_KEY,
  IS_USER_SCOPED_KEY,
} from '@auth/decorators/access.decorators';
import { AttachmentsController } from './attachments.controller';
import type { AttachmentsService } from './attachments.service';

jest.mock('node:fs', () => ({
  ...jest.requireActual<typeof import('node:fs')>('node:fs'),
  createReadStream: jest.fn(() => ({ pipe: jest.fn() })),
}));

function responseMock(): { response: Response; setHeader: jest.Mock } {
  const setHeader = jest.fn();

  return {
    response: { setHeader } as unknown as Response,
    setHeader,
  };
}

function build() {
  const attachments = {
    authorizeForSession: jest.fn(),
    authorizeSigned: jest.fn(),
  };

  const controller = new AttachmentsController(
    attachments as unknown as AttachmentsService,
  );

  return { controller, attachments };
}

const user: JwtPayload = {
  sub: 'user-1',
  memberships: [{ cid: 'co-1', mid: 'member-1', role: 'agent' }],
  ts: 1,
};

const resolved = {
  attachment: { id: 'att-1', sizeBytes: 10 },
  message: { id: 'msg-1', conversationId: 'conv-1', companyId: 'co-1' },
  url: '/attachments/att-1',
  absolutePath: '/root/co-1/media-1.jpg',
  mimeType: 'image/jpeg',
};

/**
 * T25: the private endpoint hands the verified session claims to the
 * membership check and streams from private storage; the signed route only
 * trusts an unexpired grant.
 */
describe('AttachmentsController (T25)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('needs a session but no company header, so <img> tags can load it', () => {
    const reflector = new Reflector();
    const download = AttachmentsController.prototype.download;
    const signed = AttachmentsController.prototype.downloadSigned;

    expect(reflector.get(IS_USER_SCOPED_KEY, download)).toBe(true);
    expect(reflector.get(IS_PUBLIC_KEY, download)).toBeUndefined();
    expect(reflector.get(IS_PUBLIC_KEY, signed)).toBe(true);
  });

  it('streams a session-authorized attachment with private cache headers', async () => {
    const { controller, attachments } = build();
    attachments.authorizeForSession.mockResolvedValue(resolved);
    const { response, setHeader } = responseMock();

    await controller.download('att-1', user, undefined, response);

    expect(attachments.authorizeForSession).toHaveBeenCalledWith(
      'att-1',
      user,
      undefined,
    );
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    expect(setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, max-age=0, no-store',
    );
    expect(setHeader).toHaveBeenCalledWith('Content-Length', '10');
  });

  it('forwards a client-supplied company so a mismatch can be denied', async () => {
    const { controller, attachments } = build();
    attachments.authorizeForSession.mockRejectedValue(
      new Error('Attachment belongs to another company'),
    );

    await expect(
      controller.download('att-1', user, 'co-2', responseMock().response),
    ).rejects.toThrow('Attachment belongs to another company');
    expect(attachments.authorizeForSession).toHaveBeenCalledWith(
      'att-1',
      user,
      'co-2',
    );
  });

  it('serves a direct-from-storage URL only with the signed grant', async () => {
    const { controller, attachments } = build();
    attachments.authorizeSigned.mockResolvedValue(resolved);

    await controller.downloadSigned(
      'att-1',
      '123',
      'sig-abc',
      responseMock().response,
    );

    expect(attachments.authorizeSigned).toHaveBeenCalledWith('att-1', {
      expires: '123',
      sig: 'sig-abc',
    });
    expect(attachments.authorizeForSession).not.toHaveBeenCalled();
  });
});
