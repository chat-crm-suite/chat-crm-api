// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { Response } from 'express';

import { CLS_COMPANY_ID, CLS_USER_ID } from '../../config/cls.keys';
import type { ClsService } from 'nestjs-cls';
import { AttachmentsController } from './attachments.controller';
import type { AttachmentsService } from './attachments.service';

jest.mock('node:fs', () => ({
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
  const values: Record<string, unknown> = {
    [CLS_USER_ID]: 'user-1',
    [CLS_COMPANY_ID]: 'co-1',
  };
  const cls = { get: (key: string) => values[key] };

  const controller = new AttachmentsController(
    attachments as unknown as AttachmentsService,
    cls as unknown as ClsService,
  );

  return { controller, attachments, values };
}

const resolved = {
  attachment: { id: 'att-1', sizeBytes: 10 },
  message: { id: 'msg-1', conversationId: 'conv-1', companyId: 'co-1' },
  url: '/attachments/att-1',
  absolutePath: '/root/co-1/media-1.jpg',
  mimeType: 'image/jpeg',
};

/**
 * T25: the private endpoint turns the session identity into a membership
 * check and streams from private storage; the signed route only trusts an
 * unexpired grant.
 */
describe('AttachmentsController (T25)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('streams a session-authorized attachment with private cache headers', async () => {
    const { controller, attachments } = build();
    attachments.authorizeForSession.mockResolvedValue(resolved);
    const { response, setHeader } = responseMock();

    await controller.download('att-1', response);

    expect(attachments.authorizeForSession).toHaveBeenCalledWith('att-1', {
      userId: 'user-1',
      companyId: 'co-1',
      authenticated: true,
    });
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    expect(setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, max-age=0, no-store',
    );
    expect(setHeader).toHaveBeenCalledWith('Content-Length', '10');
  });

  it('rejects a leaked URL when there is no session identity', async () => {
    const { controller, attachments, values } = build();
    values[CLS_USER_ID] = undefined;
    values[CLS_COMPANY_ID] = undefined;
    attachments.authorizeForSession.mockRejectedValue(
      new Error('Session required'),
    );

    await expect(
      controller.download('att-1', responseMock().response),
    ).rejects.toThrow('Session required');
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
