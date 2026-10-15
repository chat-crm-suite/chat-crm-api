// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { WhatsAppErrorInfo } from './clients/whatsapp.client';
import { toLegacyWhatsAppError, withReEngagementAction } from './legacy-error';

const info = (overrides: Partial<WhatsAppErrorInfo> = {}): WhatsAppErrorInfo => ({
  authFault: false,
  retryable: false,
  code: '131047',
  message: 'Re-engagement message',
  ...overrides,
});

describe('toLegacyWhatsAppError (#9)', () => {
  it('flags a 24h-window failure with the template action and recipient', () => {
    expect(
      toLegacyWhatsAppError(info(), 'text', '+15551234567'),
    ).toMatchObject({
      code: 131047,
      title: 'Whatsapp cliente error',
      message: 'Re-engagement message',
      hasAction: true,
      to: '+15551234567',
    });
  });

  it('keeps the action flag even without a known recipient', () => {
    const error = toLegacyWhatsAppError(info(), 'text');

    expect(error.hasAction).toBe(true);
    expect(error).not.toHaveProperty('to');
  });

  it('leaves other provider failures unchanged', () => {
    const error = toLegacyWhatsAppError(
      info({ code: '190', message: 'expired token' }),
      'text',
      '+15551234567',
    );

    expect(error).toEqual({
      code: 190,
      title: 'Whatsapp cliente error',
      message: 'expired token',
      error_data: {
        details: 'Request whatsapp client error for text message',
      },
    });
    expect(error).not.toHaveProperty('hasAction');
    expect(error).not.toHaveProperty('to');
  });

  it('treats a missing/unknown code as a plain failure', () => {
    const error = toLegacyWhatsAppError(info({ code: undefined }), 'text');

    expect(error.code).toBe(0);
    expect(error).not.toHaveProperty('hasAction');
  });
});

describe('withReEngagementAction (#9)', () => {
  it('adds the action and recipient to a raw 131047 status error', () => {
    expect(
      withReEngagementAction(
        {
          code: 131047,
          title: 'Re-engagement message',
          message: 'more than 24 hours have passed',
          error_data: { details: 'Message failed to send' },
        },
        '15551234567',
      ),
    ).toEqual({
      code: 131047,
      title: 'Re-engagement message',
      message: 'more than 24 hours have passed',
      error_data: { details: 'Message failed to send' },
      hasAction: true,
      to: '15551234567',
    });
  });

  it('returns any other error untouched', () => {
    const error = {
      code: 131026,
      title: 'Message undeliverable',
      message: 'Message undeliverable',
      error_data: { details: 'Message failed to send' },
    };

    expect(withReEngagementAction(error, '15551234567')).toBe(error);
  });
});
