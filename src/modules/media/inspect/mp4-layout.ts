// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

const boxType = (head: Uint8Array, offset: number) =>
  String.fromCharCode(...head.subarray(offset + 4, offset + 8));

/**
 * Whether an ISO media file is fragmented (`moof` fragments, or a `moov`
 * announcing them with `mvex`), as browser recorders write it. Read from the
 * first bytes only: a progressive file with its `moov` at the end shows no
 * fragment there and is reported as progressive.
 */
export function isFragmentedMp4(head: Uint8Array): boolean {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let offset = 0;

  while (offset + 8 <= head.length) {
    const size = view.getUint32(offset);
    const type = boxType(head, offset);

    if (type === 'moof') return true;
    if (type === 'moov') return hasChild(head, view, offset, size, 'mvex');
    // 0 = to end of file, 1 = 64-bit size: nothing more to walk in the head.
    if (size < 8) return false;

    offset += size;
  }

  return false;
}

function hasChild(
  head: Uint8Array,
  view: DataView,
  start: number,
  size: number,
  wanted: string,
): boolean {
  const end = Math.min(start + size, head.length);
  let offset = start + 8;

  while (offset + 8 <= end) {
    if (boxType(head, offset) === wanted) return true;
    const childSize = view.getUint32(offset);
    if (childSize < 8) return false;
    offset += childSize;
  }

  return false;
}
