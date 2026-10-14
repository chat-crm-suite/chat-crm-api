// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

export interface ImageInfo {
  width: number;
  height: number;
  /** Animated webp/gif (stickers have a separate size cap when animated). */
  animated: boolean;
}

/**
 * Dimensions read from the image header, so the app can reserve the frame
 * before the file loads and stickers can be checked against 512×512. `null`
 * when the header is not where the format puts it.
 */
export function readImageInfo(
  mimeType: string,
  head: Uint8Array,
): ImageInfo | null {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);

  try {
    switch (mimeType) {
      case 'image/png':
        return still(view.getUint32(16), view.getUint32(20));
      case 'image/gif':
        return {
          width: view.getUint16(6, true),
          height: view.getUint16(8, true),
          animated: countGifFrames(head) > 1,
        };
      case 'image/webp':
        return readWebp(head, view);
      case 'image/jpeg':
        return readJpeg(head, view);
      default:
        return null;
    }
  } catch {
    // A truncated header reads past the buffer: unknown, not an error.
    return null;
  }
}

const still = (width: number, height: number): ImageInfo => ({
  width,
  height,
  animated: false,
});

const fourCC = (head: Uint8Array, offset: number) =>
  String.fromCharCode(...head.subarray(offset, offset + 4));

/** `VP8 ` (lossy), `VP8L` (lossless) or `VP8X` (extended, may animate). */
function readWebp(head: Uint8Array, view: DataView): ImageInfo | null {
  const chunk = fourCC(head, 12);

  if (chunk === 'VP8 ') {
    return still(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true);
    return still((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X') {
    const uint24 = (offset: number) =>
      head[offset] | (head[offset + 1] << 8) | (head[offset + 2] << 16);
    return {
      width: uint24(24) + 1,
      height: uint24(27) + 1,
      animated: (head[20] & 0x02) !== 0,
    };
  }

  return null;
}

/** Walks the markers up to the first start-of-frame (SOF0–SOF15, no DHT/JPG/DAC). */
function readJpeg(head: Uint8Array, view: DataView): ImageInfo | null {
  let offset = 2;

  // A frame header needs 9 bytes: marker, length, precision, height, width.
  while (offset + 8 < head.length) {
    if (head[offset] !== 0xff) return null;

    const marker = head[offset + 1];
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isStartOfFrame) {
      return still(view.getUint16(offset + 7), view.getUint16(offset + 5));
    }

    offset += 2 + view.getUint16(offset + 2);
  }

  return null;
}

/** Image descriptors (0x2c) after the header; enough to tell 1 from many. */
function countGifFrames(head: Uint8Array): number {
  let frames = 0;
  for (let index = 0; index < head.length - 1 && frames < 2; index++) {
    // Graphic control extension precedes every animated frame.
    if (head[index] === 0x21 && head[index + 1] === 0xf9) frames += 1;
  }
  return frames;
}
