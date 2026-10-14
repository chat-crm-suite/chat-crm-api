// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/** Opus always counts time in 48 kHz samples, whatever the input rate. */
export const OPUS_SAMPLE_RATE = 48_000;

/** Frame sizes in 48 kHz samples per mode (RFC 6716 §3.1, Table 2). */
const SILK_FRAMES = [480, 960, 1920, 2880]; // 10, 20, 40, 60 ms
const HYBRID_FRAMES = [480, 960]; // 10, 20 ms
const CELT_FRAMES = [120, 240, 480, 960]; // 2.5, 5, 10, 20 ms

/**
 * Samples one Opus packet decodes to, read from its TOC byte: the config
 * gives the frame size, the count code the number of frames. This is what
 * the Ogg granule position counts, so the container can be rebuilt (and the
 * duration known) without decoding any audio.
 */
export function opusPacketSamples(packet: Uint8Array): number {
  if (packet.length === 0) throw new Error('Empty Opus packet');

  const toc = packet[0];
  const config = toc >> 3;
  const frameSamples =
    config < 12
      ? SILK_FRAMES[config % 4]
      : config < 16
        ? HYBRID_FRAMES[config % 2]
        : CELT_FRAMES[config % 4];

  return frameSamples * frameCount(packet);
}

function frameCount(packet: Uint8Array): number {
  switch (packet[0] & 0x03) {
    case 0:
      return 1;
    case 1:
    case 2:
      return 2;
    default:
      if (packet.length < 2) throw new Error('Truncated Opus packet');
      // Code 3: the second byte carries the frame count (M, 6 bits).
      return packet[1] & 0x3f;
  }
}
