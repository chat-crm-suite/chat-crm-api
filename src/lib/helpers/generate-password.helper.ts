// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { randomInt } from 'node:crypto';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const ALL = UPPER + LOWER + DIGITS;

const pick = (alphabet: string) => alphabet[randomInt(alphabet.length)];

/**
 * Random password for accounts created on someone's behalf (a new member, the
 * first admin of a company, a reset). Shown once to the creator, who hands it
 * over. Ambiguous characters (0/O, 1/l/I) are left out so it can be read aloud
 * or typed from a screenshot. Always holds an upper, a lower and a digit.
 */
export function generateInitialPassword(length = 14): string {
  const size = Math.max(length, 8);
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < size) chars.push(pick(ALL));

  // Fisher-Yates with a CSPRNG, so the three guaranteed characters do not
  // always sit at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}
