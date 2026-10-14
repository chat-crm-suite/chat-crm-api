// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { OPUS_SAMPLE_RATE } from './opus-packet';

/** Matroska/WebM element ids this reader understands. */
const ID = {
  Segment: 0x18538067,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  CodecId: 0x86,
  CodecPrivate: 0x63a2,
  Audio: 0xe1,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  BlockGroup: 0xa0,
  Block: 0xa1,
  SimpleBlock: 0xa3,
} as const;

/** Containers read inline: their children are parsed in place. */
const CONTAINERS = new Set<number>([
  ID.Segment,
  ID.Tracks,
  ID.TrackEntry,
  ID.Audio,
  ID.Cluster,
  ID.BlockGroup,
]);

/** libopus' default encoder delay, used when the track has no OpusHead. */
const DEFAULT_PRE_SKIP = 312;

export interface WebmOpusStream {
  /** `OpusHead` identification header for the Ogg file. */
  head: Uint8Array;
  /** Raw Opus packets in presentation order. */
  packets: Uint8Array[];
}

interface Track {
  number?: number;
  codecId?: string;
  codecPrivate?: Uint8Array;
  channels?: number;
}

/**
 * Extracts the Opus track of a WebM file the way browsers record it
 * (`MediaRecorder`: one audio track, live-written clusters of unknown size,
 * unlaced SimpleBlocks). The element tree is walked flat: containers are
 * entered inline instead of skipped, which handles unknown sizes without
 * buffering the hierarchy; everything else is skipped by its size.
 */
export function readWebmOpus(data: Uint8Array): WebmOpusStream {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tracks: Track[] = [];
  const blocks: Array<{ track: number; frame: Uint8Array }> = [];
  let offset = 0;

  while (offset < data.length) {
    const id = readVint(data, offset, true);
    const size = readVint(data, offset + id.length, false);
    const start = offset + id.length + size.length;

    if (CONTAINERS.has(id.value)) {
      if (id.value === ID.TrackEntry) tracks.push({});
      offset = start;
      continue;
    }
    if (size.unknown) {
      throw new Error(`Unexpected unknown-size element 0x${id.value.toString(16)}`);
    }

    const end = start + size.value;
    if (end > data.length) break; // a recording cut mid-element: keep what is whole

    const body = data.subarray(start, end);
    const track = tracks[tracks.length - 1];

    switch (id.value) {
      case ID.TrackNumber:
        if (track) track.number = readUint(body);
        break;
      case ID.CodecId:
        if (track) track.codecId = Buffer.from(body).toString('latin1');
        break;
      case ID.CodecPrivate:
        if (track) track.codecPrivate = body;
        break;
      case ID.Channels:
        if (track) track.channels = readUint(body);
        break;
      case ID.SimpleBlock:
      case ID.Block:
        blocks.push(readBlock(body, view, start));
        break;
    }

    offset = end;
  }

  const opus = tracks.find((track) => track.codecId === 'A_OPUS');
  if (!opus?.number) throw new Error('The recording has no Opus audio track');

  const packets = blocks
    .filter((block) => block.track === opus.number)
    .map((block) => block.frame);

  return { head: opus.codecPrivate ?? defaultOpusHead(opus.channels ?? 1), packets };
}

/** SimpleBlock/Block: track (vint), relative timecode (int16), flags, frame. */
function readBlock(
  body: Uint8Array,
  view: DataView,
  absoluteStart: number,
): { track: number; frame: Uint8Array } {
  const track = readVint(body, 0, false);
  const flags = view.getUint8(absoluteStart + track.length + 2);
  if ((flags & 0x06) !== 0) {
    throw new Error('Laced WebM blocks are not supported');
  }

  return { track: track.value, frame: body.subarray(track.length + 3) };
}

/**
 * EBML variable-length integer: the leading zeros of the first byte give the
 * length. Ids keep their marker bit; sizes drop it, and all-ones means
 * "unknown" (a live-written container).
 */
function readVint(
  data: Uint8Array,
  offset: number,
  keepMarker: boolean,
): { value: number; length: number; unknown: boolean } {
  const first = data[offset];
  if (first === undefined || first === 0) {
    throw new Error('Corrupt WebM: invalid element header');
  }

  const length = Math.clz32(first) - 23;
  if (offset + length > data.length) {
    throw new Error('Corrupt WebM: truncated element header');
  }

  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let index = 1; index < length; index++) {
    const byte = data[offset + index];
    value = value * 256 + byte;
    allOnes &&= byte === 0xff;
  }

  return { value, length, unknown: !keepMarker && allOnes };
}

function readUint(body: Uint8Array): number {
  return body.reduce((value, byte) => value * 256 + byte, 0);
}

/** RFC 7845 §5.1 identification header for a mono/stereo stream. */
function defaultOpusHead(channels: number): Uint8Array {
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 'latin1');
  head.writeUInt8(1, 8); // version
  head.writeUInt8(channels, 9);
  head.writeUInt16LE(DEFAULT_PRE_SKIP, 10);
  head.writeUInt32LE(OPUS_SAMPLE_RATE, 12);
  head.writeInt16LE(0, 16); // output gain
  head.writeUInt8(0, 18); // channel mapping family
  return head;
}
