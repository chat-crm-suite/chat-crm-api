// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { isFragmentedMp4 } from './mp4-layout';

const box = (type: string, ...children: Buffer[]) => {
  const body = Buffer.concat(children);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, body]);
};

describe('isFragmentedMp4', () => {
  it('spots browser recordings: mvex in moov or moof fragments', () => {
    expect(
      isFragmentedMp4(Buffer.concat([box('ftyp'), box('moov', box('mvhd'), box('mvex'))])),
    ).toBe(true);
    expect(isFragmentedMp4(Buffer.concat([box('ftyp'), box('moof'), box('mdat')]))).toBe(true);
  });

  it('accepts progressive files, moov first or last', () => {
    expect(
      isFragmentedMp4(Buffer.concat([box('ftyp'), box('moov', box('mvhd'), box('trak')), box('mdat')])),
    ).toBe(false);
    // `moov` at the end lies past the head: only `mdat` is seen.
    expect(isFragmentedMp4(Buffer.concat([box('ftyp'), box('mdat', Buffer.alloc(64))]))).toBe(false);
  });
});
