// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { opusPacketSamples } from './opus-packet';

const VENDOR = 'chat-crm';
/** Keeps pages small enough to stream, like common muxers (~4 KB). */
const PAGE_TARGET_BYTES = 4096;
const MAX_SEGMENTS = 255;

const FLAG_FIRST_PAGE = 0x02;
const FLAG_LAST_PAGE = 0x04;

export interface OggOpusInput {
  /** The 19+ byte `OpusHead` identification header. */
  head: Uint8Array;
  packets: readonly Uint8Array[];
  /** Logical stream id (any 32-bit value). */
  serial: number;
}

export interface OggOpusOutput {
  data: Buffer;
  /** Decoded samples at 48 kHz, including the encoder pre-skip. */
  totalSamples: number;
}

/**
 * Builds an Ogg Opus file (RFC 7845): identification header page, comment
 * header page, then the audio packets paginated with granule positions
 * counted from each packet's TOC. Packets are copied untouched: this is a
 * container change, never a re-encode, so quality is preserved.
 */
export function writeOggOpus({
  head,
  packets,
  serial,
}: OggOpusInput): OggOpusOutput {
  if (!packets.length) {
    throw new Error('A voice note needs at least one audio packet');
  }

  const pages: Buffer[] = [];
  let sequence = 0;
  const page = (data: Uint8Array[], granule: number, flags: number) =>
    pages.push(oggPage(data, { granule, flags, serial, sequence: sequence++ }));

  page([head], 0, FLAG_FIRST_PAGE);
  page([opusTags()], 0, 0);

  let granule = 0;
  let pending: Uint8Array[] = [];
  let pendingSegments = 0;
  let pendingBytes = 0;

  packets.forEach((packet, index) => {
    const segments = Math.floor(packet.length / 255) + 1;
    if (
      pending.length &&
      (pendingSegments + segments > MAX_SEGMENTS ||
        pendingBytes + packet.length > PAGE_TARGET_BYTES)
    ) {
      page(pending, granule, 0);
      pending = [];
      pendingSegments = 0;
      pendingBytes = 0;
    }

    granule += opusPacketSamples(packet);
    pending.push(packet);
    pendingSegments += segments;
    pendingBytes += packet.length;

    if (index === packets.length - 1) page(pending, granule, FLAG_LAST_PAGE);
  });

  return { data: Buffer.concat(pages), totalSamples: granule };
}

/** `OpusTags` comment header: vendor string and no user comments. */
function opusTags(): Uint8Array {
  const vendor = Buffer.from(VENDOR, 'utf8');
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
  tags.write('OpusTags', 0, 'latin1');
  tags.writeUInt32LE(vendor.length, 8);
  vendor.copy(tags, 12);
  tags.writeUInt32LE(0, 12 + vendor.length);
  return tags;
}

/** One Ogg page holding whole packets (laced with 255-byte segments). */
function oggPage(
  packets: Uint8Array[],
  header: { granule: number; flags: number; serial: number; sequence: number },
): Buffer {
  const lacing = packets.flatMap((packet) => [
    ...new Array<number>(Math.floor(packet.length / 255)).fill(255),
    packet.length % 255,
  ]);

  const page = Buffer.alloc(27 + lacing.length);
  page.write('OggS', 0, 'latin1');
  page.writeUInt8(0, 4); // stream structure version
  page.writeUInt8(header.flags, 5);
  page.writeBigUInt64LE(BigInt(header.granule), 6);
  page.writeUInt32LE(header.serial >>> 0, 14);
  page.writeUInt32LE(header.sequence, 18);
  page.writeUInt32LE(0, 22); // CRC, filled below
  page.writeUInt8(lacing.length, 26);
  Buffer.from(lacing).copy(page, 27);

  const full = Buffer.concat([page, ...packets]);
  full.writeUInt32LE(oggCrc32(full), 22);
  return full;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** Ogg's CRC-32: polynomial 0x04C11DB7, not reflected, no init/final xor. */
export function oggCrc32(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  }
  return crc;
}
