// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { readImageInfo } from './image-info';

/** Little helpers to lay out the header fields each format defines. */
const u16be = (value: number) => [value >> 8, value & 0xff];
const u16le = (value: number) => [value & 0xff, value >> 8];
const u32be = (value: number) => [0, 0, ...u16be(value)];
const u24le = (value: number) => [value & 0xff, (value >> 8) & 0xff, value >> 16];
const text = (value: string) => [...Buffer.from(value, 'latin1')];
const head = (...parts: number[][]) => Uint8Array.from(parts.flat());

describe('readImageInfo', () => {
  it('reads png dimensions from IHDR', () => {
    const png = head(
      [0x89], text('PNG'), [0x0d, 0x0a, 0x1a, 0x0a],
      u32be(13), text('IHDR'), u32be(640), u32be(480),
    );

    expect(readImageInfo('image/png', png)).toEqual({
      width: 640,
      height: 480,
      animated: false,
    });
  });

  it('reads jpeg dimensions from the first start-of-frame', () => {
    const jpeg = head(
      [0xff, 0xd8],
      // APP0 segment of 16 bytes (length includes itself).
      [0xff, 0xe0], u16be(16), new Array<number>(14).fill(0),
      // SOF0: length, precision, height, width.
      [0xff, 0xc0], u16be(17), [8], u16be(1080), u16be(1920),
    );

    expect(readImageInfo('image/jpeg', jpeg)).toEqual({
      width: 1920,
      height: 1080,
      animated: false,
    });
  });

  it('reads the three webp flavours and the animation flag', () => {
    const riff = (chunk: string, data: number[]) =>
      head(text('RIFF'), [0, 0, 0, 0], text('WEBP'), text(chunk), [0, 0, 0, 0], data);

    const lossy = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(512), ...u16le(512)]);
    const lossless = riff('VP8L', [0x2f, 0xff, 0xc1, 0x7f, 0x00]);
    const animated = riff('VP8X', [0x02, 0, 0, 0, ...u24le(511), ...u24le(511)]);

    expect(readImageInfo('image/webp', lossy)).toEqual({
      width: 512,
      height: 512,
      animated: false,
    });
    expect(readImageInfo('image/webp', lossless)).toEqual({
      width: 512,
      height: 512,
      animated: false,
    });
    expect(readImageInfo('image/webp', animated)).toEqual({
      width: 512,
      height: 512,
      animated: true,
    });
  });

  it('reads gif dimensions and tells animated gifs apart', () => {
    const frame = [0x21, 0xf9, 4, 0, 0, 0, 0, 0];
    const gif = (frames: number) =>
      head(text('GIF89a'), u16le(320), u16le(200), ...new Array(frames).fill(frame));

    expect(readImageInfo('image/gif', gif(1))?.animated).toBe(false);
    expect(readImageInfo('image/gif', gif(3))).toEqual({
      width: 320,
      height: 200,
      animated: true,
    });
  });

  it('returns null for truncated headers and non-images', () => {
    expect(readImageInfo('image/png', head([0x89], text('PNG')))).toBeNull();
    expect(readImageInfo('application/pdf', head(text('%PDF-')))).toBeNull();
  });
});
