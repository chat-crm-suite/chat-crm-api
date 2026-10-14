// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { oggCrc32 } from './ogg-opus-writer';
import { opusPacketSamples } from './opus-packet';
import { readWebmOpus } from './webm-opus-reader';
import { WebmOpusToOggNormalizer } from './webm-opus-to-ogg.normalizer';

// ---------------------------------------------------------------------------
// Synthetic WebM, laid out like Chrome's MediaRecorder output.
// ---------------------------------------------------------------------------

const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

/** Big-endian bytes of an element id (ids keep their length marker). */
const idBytes = (id: number) => {
  const bytes: number[] = [];
  for (let value = id; value > 0; value = Math.floor(value / 256)) {
    bytes.unshift(value & 0xff);
  }
  return bytes;
};

/** Size as a 4-byte EBML vint (marker 0x10). */
const sizeBytes = (size: number) => [
  0x10 | (size >>> 24),
  (size >>> 16) & 0xff,
  (size >>> 8) & 0xff,
  size & 0xff,
];

const element = (id: number, payload: number[], unknown = false) => [
  ...idBytes(id),
  ...(unknown ? UNKNOWN_SIZE : sizeBytes(payload.length)),
  ...payload,
];

const text = (value: string) => [...Buffer.from(value, 'latin1')];

const opusHead = (preSkip: number) => [
  ...text('OpusHead'),
  1, // version
  1, // channels
  preSkip & 0xff,
  preSkip >> 8,
  0x80, 0xbb, 0, 0, // 48000 Hz
  0, 0, // gain
  0, // mapping family
];

/** CELT 20 ms, one frame: TOC config 31, code 0 → 960 samples. */
const packet = (fill: number) => [0xf8, fill, fill, fill];

const simpleBlock = (track: number, frame: number[], flags = 0x80) =>
  element(0xa3, [0x80 | track, 0, 0, flags, ...frame]);

function recording(options: {
  packets: number;
  codecPrivate?: boolean;
  codec?: string;
  laced?: boolean;
}): Uint8Array {
  const trackEntry = element(0xae, [
    ...element(0xd7, [1]), // TrackNumber
    ...element(0x83, [2]), // TrackType: audio
    ...element(0x86, text(options.codec ?? 'A_OPUS')),
    ...(options.codecPrivate === false ? [] : element(0x63a2, opusHead(312))),
    ...element(0xe1, element(0x9f, [1])), // Audio > Channels
  ]);

  const blocks = Array.from({ length: options.packets }, (_, index) =>
    simpleBlock(1, packet(index % 256), options.laced ? 0x82 : 0x80),
  );
  const half = Math.ceil(blocks.length / 2);
  const cluster = (part: number[][]) =>
    element(0x1f43b675, [...element(0xe7, [0]), ...part.flat()], true);

  return Uint8Array.from([
    ...element(0x1a45dfa3, element(0x4282, text('webm'))), // EBML header
    ...element(
      0x18538067,
      [
        ...element(0x1549a966, element(0x2ad7b1, [0x0f, 0x42, 0x40])), // Info
        ...element(0x1654ae6b, trackEntry), // Tracks
        ...cluster(blocks.slice(0, half)),
        ...cluster(blocks.slice(half)),
      ],
      true,
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Minimal Ogg reader to check the output page by page.
// ---------------------------------------------------------------------------

interface OggPage {
  flags: number;
  granule: bigint;
  sequence: number;
  crcValid: boolean;
  packets: Buffer[];
}

function readOgg(data: Buffer): OggPage[] {
  const pages: OggPage[] = [];
  let offset = 0;

  while (offset < data.length) {
    expect(data.toString('latin1', offset, offset + 4)).toBe('OggS');
    const segments = data[offset + 26];
    const lacing = [...data.subarray(offset + 27, offset + 27 + segments)];
    const bodyLength = lacing.reduce((sum, value) => sum + value, 0);
    const end = offset + 27 + segments + bodyLength;

    const page = Buffer.from(data.subarray(offset, end));
    const stored = page.readUInt32LE(22);
    page.writeUInt32LE(0, 22);

    const packets: Buffer[] = [];
    let cursor = offset + 27 + segments;
    let current: number[] = [];
    for (const value of lacing) {
      current.push(...data.subarray(cursor, cursor + value));
      cursor += value;
      if (value < 255) {
        packets.push(Buffer.from(current));
        current = [];
      }
    }

    pages.push({
      flags: data[offset + 5],
      granule: data.readBigUInt64LE(offset + 6),
      sequence: data.readUInt32LE(offset + 18),
      crcValid: oggCrc32(page) === stored,
      packets,
    });
    offset = end;
  }

  return pages;
}

// ---------------------------------------------------------------------------

describe('opusPacketSamples', () => {
  it.each([
    ['SILK 10 ms', [0x00], 480],
    ['SILK 60 ms', [0x18], 2880],
    ['Hybrid 20 ms', [0x68], 960],
    ['CELT 2.5 ms', [0x80], 120],
    ['CELT 20 ms, two frames (code 1)', [0xf9], 1920],
    ['CELT 20 ms, three frames (code 3)', [0xfb, 0x03], 2880],
  ])('%s', (_label, bytes, samples) => {
    expect(opusPacketSamples(Uint8Array.from(bytes))).toBe(samples);
  });

  it('refuses empty or truncated packets', () => {
    expect(() => opusPacketSamples(new Uint8Array())).toThrow();
    expect(() => opusPacketSamples(Uint8Array.from([0xfb]))).toThrow();
  });
});

describe('oggCrc32', () => {
  it('matches the Ogg CRC check value (poly 0x04C11DB7, init 0, no xor)', () => {
    expect(oggCrc32(Buffer.from('123456789'))).toBe(0x89a1897f);
  });
});

describe('readWebmOpus', () => {
  it('extracts the OpusHead and every packet across unknown-size clusters', () => {
    const { head, packets } = readWebmOpus(recording({ packets: 6 }));

    expect(Buffer.from(head).toString('latin1', 0, 8)).toBe('OpusHead');
    expect(packets).toHaveLength(6);
    expect([...packets[5]]).toEqual(packet(5));
  });

  it('builds a default OpusHead when the track carries none', () => {
    const { head } = readWebmOpus(recording({ packets: 1, codecPrivate: false }));

    expect(Buffer.from(head).toString('latin1', 0, 8)).toBe('OpusHead');
    expect(Buffer.from(head).readUInt16LE(10)).toBe(312);
  });

  it('refuses files without an Opus track or with laced blocks', () => {
    expect(() => readWebmOpus(recording({ packets: 1, codec: 'A_VORBIS' }))).toThrow(
      'no Opus audio track',
    );
    expect(() => readWebmOpus(recording({ packets: 1, laced: true }))).toThrow(
      'Laced',
    );
  });
});

describe('WebmOpusToOggNormalizer', () => {
  const normalizer = new WebmOpusToOggNormalizer(() => 0x1234);

  it('only takes webm audio for channels that accept ogg', () => {
    expect(normalizer.supports('audio/webm', ['audio/ogg'])).toBe(true);
    expect(normalizer.supports('audio/webm', ['audio/mpeg'])).toBe(false);
    expect(normalizer.supports('audio/ogg', ['audio/ogg'])).toBe(false);
  });

  it('rewraps the packets as a valid Ogg Opus stream with exact granules', () => {
    // 50 packets x 20 ms = 1 s of audio.
    const result = normalizer.normalize({
      data: Buffer.from(recording({ packets: 50 })),
      mimeType: 'audio/webm',
    });

    expect(result).toMatchObject({ mimeType: 'audio/ogg', extension: 'ogg' });
    // (50 x 960 - 312 pre-skip) / 48 kHz.
    expect(result.durationMs).toBe(994);

    const pages = readOgg(result.data);
    expect(pages.every((page) => page.crcValid)).toBe(true);
    expect(pages.map((page) => page.sequence)).toEqual(pages.map((_, index) => index));

    const [identification, comments, ...audio] = pages;
    expect(identification.flags).toBe(0x02);
    expect(identification.packets[0].toString('latin1', 0, 8)).toBe('OpusHead');
    expect(comments.packets[0].toString('latin1', 0, 8)).toBe('OpusTags');

    const last = audio[audio.length - 1];
    expect(last.flags & 0x04).toBe(0x04);
    expect(last.granule).toBe(BigInt(50 * 960));

    const packets = audio.flatMap((page) => page.packets);
    expect(packets).toHaveLength(50);
    expect([...packets[49]]).toEqual(packet(49));
  });

  it('paginates long recordings within the 255-segment limit', () => {
    const result = normalizer.normalize({
      data: Buffer.from(recording({ packets: 600 })),
      mimeType: 'audio/webm',
    });

    const audio = readOgg(result.data).slice(2);
    expect(audio.length).toBeGreaterThan(1);
    expect(audio.flatMap((page) => page.packets)).toHaveLength(600);
    // Granules grow page by page.
    const granules = audio.map((page) => page.granule);
    expect([...granules].sort((a, b) => (a < b ? -1 : 1))).toEqual(granules);
  });
});
