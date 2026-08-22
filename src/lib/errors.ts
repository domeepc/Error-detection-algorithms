/**
 * Error injection.
 *
 * Errors are described as *patterns* — a bit array E the same length as the frame, XORed
 * into it. That framing is what makes CRC's guarantees provable: the received frame is
 * C(x) + E(x), and since C(x) is divisible by g(x), the remainder depends only on E(x).
 * An error is undetectable precisely when g(x) divides E(x).
 */

import type { Bit, Bits } from './gf2';

function randInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

/* ------------------------------------------------------------------ *
 * Applying patterns
 * ------------------------------------------------------------------ */

export function applyPattern(frame: Bits, pattern: Bits): Bits {
  if (frame.length !== pattern.length) {
    throw new Error(`Error pattern length ${pattern.length} does not match frame length ${frame.length}`);
  }
  return frame.map((b, i) => (b ^ pattern[i]) as Bit);
}

export function patternFromIndices(length: number, indices: number[]): Bits {
  const pattern: Bits = Array(length).fill(0) as Bits;
  for (const i of indices) {
    if (i < 0 || i >= length) throw new Error(`Bit index ${i} is outside the frame (0-${length - 1})`);
    pattern[i] = 1;
  }
  return pattern;
}

export function indicesFromPattern(pattern: Bits): number[] {
  return pattern.flatMap((b, i) => (b ? [i] : []));
}

/* ------------------------------------------------------------------ *
 * Pattern generators
 * ------------------------------------------------------------------ */

/** `count` distinct random bit positions. */
export function randomError(length: number, count: number): Bits {
  if (count < 0) throw new Error('Error count cannot be negative');
  if (count > length) throw new Error(`Cannot flip ${count} bits in a ${length}-bit frame`);
  const chosen = new Set<number>();
  while (chosen.size < count) chosen.add(randInt(length));
  return patternFromIndices(length, [...chosen]);
}

/**
 * A burst of length L: the first and last bits of the span are flipped by definition,
 * and the bits between them are flipped at random.
 *
 * Pinning both ends is what makes "burst length" well defined — otherwise a burst of
 * length 8 with clear ends would really be a shorter burst, and the detection guarantee
 * (`all bursts of length <= r are caught`) would not hold as stated.
 */
export function burstError(length: number, start: number, burstLength: number): Bits {
  if (burstLength < 1) throw new Error('Burst length must be at least 1');
  if (start < 0 || start + burstLength > length) {
    throw new Error(`A ${burstLength}-bit burst at offset ${start} does not fit in a ${length}-bit frame`);
  }
  const pattern: Bits = Array(length).fill(0) as Bits;
  pattern[start] = 1;
  pattern[start + burstLength - 1] = 1;
  for (let i = start + 1; i < start + burstLength - 1; i++) {
    pattern[i] = (Math.random() < 0.5 ? 1 : 0) as Bit;
  }
  return pattern;
}

export function randomBurst(length: number, burstLength: number): Bits {
  if (burstLength > length) {
    throw new Error(`A ${burstLength}-bit burst does not fit in a ${length}-bit frame`);
  }
  return burstError(length, randInt(length - burstLength + 1), burstLength);
}

/** Actual span from first to last flipped bit — the burst length as a receiver would measure it. */
export function burstSpan(pattern: Bits): number {
  const first = pattern.indexOf(1);
  if (first === -1) return 0;
  const last = pattern.lastIndexOf(1);
  return last - first + 1;
}

/* ------------------------------------------------------------------ *
 * Scheme-agnostic detection record
 * ------------------------------------------------------------------ */

export type SchemeId = 'crc' | 'vrc' | 'lrc' | 'vrc+lrc' | 'checksum';

export interface DetectionOutcome {
  scheme: SchemeId;
  label: string;
  /** True when the scheme flagged the frame as corrupt. */
  detected: boolean;
  /** Human-readable evidence, e.g. a nonzero remainder or the failing row/column. */
  detail: string;
}
