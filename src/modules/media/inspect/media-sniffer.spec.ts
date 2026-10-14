// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { trustedMimeType } from './media-sniffer';

const bytes = (...parts: Array<number[] | string>) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : part,
    ),
  );

const ftyp = (brand: string) => bytes([0, 0, 0, 0x20], 'ftyp', brand);

describe('trustedMimeType', () => {
  it.each([
    ['image/jpeg', bytes([0xff, 0xd8, 0xff, 0xe0])],
    ['image/png', bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a])],
    ['image/gif', bytes('GIF89a')],
    ['image/webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')],
    ['application/pdf', bytes('%PDF-1.7')],
    ['audio/ogg', bytes('OggS', [0])],
    ['audio/amr', bytes('#!AMR\n')],
    ['audio/mpeg', bytes('ID3', [4, 0])],
    ['audio/mpeg', bytes([0xff, 0xfb, 0x90])],
    ['audio/aac', bytes([0xff, 0xf1, 0x50])],
  ])('identifies %s by its content', (expected, head) => {
    // Whatever the browser claimed.
    expect(trustedMimeType('application/octet-stream', head)).toBe(expected);
  });

  it('never trusts the declared type over the content', () => {
    const png = bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]);

    expect(trustedMimeType('image/jpeg', png)).toBe('image/png');
    // A renamed executable is not a pdf.
    expect(trustedMimeType('application/pdf', bytes('MZ', [0x90, 0]))).toBeNull();
  });

  it('splits webm between audio and video by the declared kind', () => {
    const webm = bytes([0x1a, 0x45, 0xdf, 0xa3]);

    expect(trustedMimeType('audio/webm;codecs=opus', webm)).toBe('audio/webm');
    expect(trustedMimeType('video/webm', webm)).toBe('video/webm');
  });

  it('reads the ISO media brand (mp4, 3gp, m4a, quicktime)', () => {
    expect(trustedMimeType('video/mp4', ftyp('isom'))).toBe('video/mp4');
    expect(trustedMimeType('audio/mp4', ftyp('mp42'))).toBe('audio/mp4');
    expect(trustedMimeType('', ftyp('3gp5'))).toBe('video/3gpp');
    expect(trustedMimeType('', ftyp('M4A '))).toBe('audio/mp4');
    expect(trustedMimeType('', ftyp('qt  '))).toBe('video/quicktime');
  });

  it('accepts zip and OLE containers only as the Office type they claim', () => {
    const zip = bytes('PK', [0x03, 0x04]);
    const ole = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const docx =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    expect(trustedMimeType(docx, zip)).toBe(docx);
    expect(trustedMimeType('application/zip', zip)).toBeNull();
    expect(trustedMimeType('application/msword', ole)).toBe('application/msword');
    expect(trustedMimeType('application/pdf', ole)).toBeNull();
  });

  it('accepts declared text only when it is valid UTF-8 without NUL bytes', () => {
    const utf8 = Uint8Array.from(Buffer.from('Hola, ñandú', 'utf8'));
    expect(trustedMimeType('text/plain', utf8)).toBe('text/plain');
    expect(trustedMimeType('text/csv', bytes('a,b\n1,2'))).toBe('text/csv');
    expect(trustedMimeType('text/plain', bytes('a', [0], 'b'))).toBeNull();
    expect(trustedMimeType('text/plain', bytes([0xc3, 0x28]))).toBeNull();
    // A multi-byte character cut by the head is still text.
    expect(trustedMimeType('text/plain', bytes('ok ', [0xc3]))).toBe('text/plain');
  });
});
