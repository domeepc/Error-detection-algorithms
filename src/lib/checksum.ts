/**
 * Checksums, in two modes and at any word width.
 *
 *   'internet'  RFC 1071 style — one's-complement sum with end-around carry, complemented.
 *               At 16 bits this is exactly what IPv4, ICMP, UDP and TCP use.
 *   'modular'   Plain sum modulo 2^w, carries discarded.
 *
 * The word width is a free parameter rather than being fixed at 8 or 16: the arithmetic is
 * identical at any width, and small widths (4, 5, 6) are far easier to follow by hand.
 * Data that does not fill a whole number of words is **zero-padded on the right**, which is
 * what RFC 1071 specifies for an odd trailing byte and generalises cleanly.
 *
 * Arithmetic note: all folding uses `%` and `Math.floor` rather than `&` and `>>>`, because
 * JavaScript's bitwise operators coerce to *signed 32-bit* and would corrupt any width at or
 * near 32 bits.
 */

import { type Bits, chunk, padRight } from './gf2';

export type ChecksumMode = 'internet' | 'modular';

export const MAX_WORD_BITS = 32;
export const MIN_WORD_BITS = 2;

export interface ChecksumOptions {
  /** Word width in bits, 2–32. Defaults to 16 for 'internet', 8 for 'modular'. */
  wordBits?: number;
  /** Complement the final sum. Always true for the internet checksum. */
  complement?: boolean;
}

export interface ChecksumStep {
  /** 1-based index of the word being added. */
  index: number;
  word: number;
  wordBinary: string;
  /** Running total before adding. */
  before: number;
  /** Raw total after adding, before any fold or truncation. */
  rawSum: number;
  /** True when the raw sum exceeded the word width. */
  carried: boolean;
  /** How the overflow was handled. */
  carryAction: 'folded' | 'dropped' | 'none';
  /** Running total after folding/truncation. */
  after: number;
  afterBinary: string;
}

export interface ChecksumResult {
  mode: ChecksumMode;
  wordBits: number;
  /** The data actually summed, after zero-padding. */
  paddedBits: Bits;
  words: number[];
  wordsBinary: string[];
  steps: ChecksumStep[];
  /** Accumulated sum before the final complement. */
  sum: number;
  sumBinary: string;
  /** The transmitted check value. */
  checksum: number;
  checksumBinary: string;
  /** How many zero bits were appended to fill the final word. */
  padBits: number;
  padded: boolean;
}

function assertWordBits(w: number): void {
  if (!Number.isInteger(w) || w < MIN_WORD_BITS || w > MAX_WORD_BITS) {
    throw new Error(`Word width must be an integer from ${MIN_WORD_BITS} to ${MAX_WORD_BITS}, got ${w}`);
  }
}

export function toBinaryString(value: number, bits: number): string {
  return value.toString(2).padStart(bits, '0');
}

/**
 * Split bits into words of the given width, zero-padding the tail.
 *
 * Padding goes on the right so the leading bits keep their place value — padding on the
 * left would silently renumber every word.
 */
export function bitsToWords(
  bits: Bits,
  wordBits: number,
): { words: number[]; paddedBits: Bits; padBits: number } {
  assertWordBits(wordBits);
  const remainder = bits.length % wordBits;
  const padBits = remainder === 0 ? 0 : wordBits - remainder;
  const paddedBits = padBits === 0 ? bits.slice() : padRight(bits, bits.length + padBits);
  const words = chunk(paddedBits, wordBits).map((w) => parseInt(w.join(''), 2));
  return { words, paddedBits, padBits };
}

/**
 * Core routine — both modes differ only in what happens to the carry.
 *
 * 'internet' folds the overflow back into the low end (end-around carry), which is what
 * makes the sum independent of word order. 'modular' discards it, which is precisely the
 * weakness the fold avoids.
 */
export function checksumFromBits(
  bits: Bits,
  mode: ChecksumMode,
  opts: ChecksumOptions = {},
): ChecksumResult {
  const wordBits = opts.wordBits ?? (mode === 'internet' ? 16 : 8);
  assertWordBits(wordBits);
  const complement = mode === 'internet' ? true : (opts.complement ?? true);

  const modulus = Math.pow(2, wordBits);
  const mask = modulus - 1;
  const { words, paddedBits, padBits } = bitsToWords(bits, wordBits);
  const steps: ChecksumStep[] = [];
  let sum = 0;

  words.forEach((word, i) => {
    const before = sum;
    const rawSum = before + word;
    const carried = rawSum > mask;

    let after: number;
    let carryAction: ChecksumStep['carryAction'];
    if (!carried) {
      after = rawSum;
      carryAction = 'none';
    } else if (mode === 'internet') {
      // End-around carry: add the overflow back in, repeating if that overflows again.
      let folded = rawSum;
      while (folded > mask) folded = (folded % modulus) + Math.floor(folded / modulus);
      after = folded;
      carryAction = 'folded';
    } else {
      after = rawSum % modulus;
      carryAction = 'dropped';
    }

    steps.push({
      index: i + 1,
      word,
      wordBinary: toBinaryString(word, wordBits),
      before,
      rawSum,
      carried,
      carryAction,
      after,
      afterBinary: toBinaryString(after, wordBits),
    });
    sum = after;
  });

  // mask - sum is the one's complement, without the signed-32-bit trap that ~ carries.
  const checksum = complement ? mask - sum : sum;

  return {
    mode,
    wordBits,
    paddedBits,
    words,
    wordsBinary: words.map((w) => toBinaryString(w, wordBits)),
    steps,
    sum,
    sumBinary: toBinaryString(sum, wordBits),
    checksum,
    checksumBinary: toBinaryString(checksum, wordBits),
    padBits,
    padded: padBits > 0,
  };
}

export interface VerifyResult {
  ok: boolean;
  /** The value the receiver computed. */
  total: number;
  totalBinary: string;
  /** What an intact frame should produce. */
  expected: number;
  expectedBinary: string;
  /**
   * How the check was made. A complemented checksum lets the receiver fold it into the
   * sum and look for a saturated result; an uncomplemented one carries no such property,
   * so the only option is to recompute and compare.
   */
  method: 'sum-including-checksum' | 'recompute-and-compare';
}

export function verifyFromBits(
  bits: Bits,
  checksum: number,
  mode: ChecksumMode,
  opts: ChecksumOptions = {},
): VerifyResult {
  const wordBits = opts.wordBits ?? (mode === 'internet' ? 16 : 8);
  assertWordBits(wordBits);
  const complement = mode === 'internet' ? true : (opts.complement ?? true);
  const modulus = Math.pow(2, wordBits);
  const mask = modulus - 1;
  const { words } = bitsToWords(bits, wordBits);

  const fold = (n: number): number => {
    if (mode === 'internet') {
      let v = n;
      while (v > mask) v = (v % modulus) + Math.floor(v / modulus);
      return v;
    }
    return n % modulus;
  };

  if (!complement) {
    // Nothing cancels, so recompute the data sum and compare it against what arrived.
    let sum = 0;
    for (const w of words) sum = fold(sum + w);
    return {
      ok: sum === checksum % modulus,
      total: sum,
      totalBinary: toBinaryString(sum, wordBits),
      expected: checksum % modulus,
      expectedBinary: toBinaryString(checksum % modulus, wordBits),
      method: 'recompute-and-compare',
    };
  }

  // x + ~x saturates, so an intact frame sums to all ones.
  let sum = 0;
  for (const w of [...words, checksum % modulus]) sum = fold(sum + w);

  return {
    ok: sum === mask,
    total: sum,
    totalBinary: toBinaryString(sum, wordBits),
    expected: mask,
    expectedBinary: toBinaryString(mask, wordBits),
    method: 'sum-including-checksum',
  };
}

export function toHex(value: number, bits: number): string {
  return '0x' + value.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0');
}
