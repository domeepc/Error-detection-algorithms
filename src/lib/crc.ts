/**
 * CRC generation and verification, built on the `polyDivideSteps` trace from gf2.ts.
 *
 * This is the textbook path: no initial value, no reflection, no final XOR. That keeps
 * the arithmetic identical to what the long-division table and the LFSR diagram show.
 * (Real-world named CRCs layer init/refin/refout/xorout on top; see the plan's optional
 * Rocksoft phase.)
 */

import {
  type Bits,
  type DivisionResult,
  polyDivideSteps,
  padLeft,
  isZero,
  normalize,
} from './gf2';

export interface CrcResult {
  /** The original message bits. */
  message: Bits;
  /** Message followed by r zeros — what actually gets divided. */
  augmented: Bits;
  /** The r-bit frame check sequence. */
  fcs: Bits;
  /** Message followed by the FCS — what goes on the wire. */
  codeword: Bits;
  /** Full division trace, for rendering the long-division table. */
  division: DivisionResult;
  /** r = deg(g). */
  width: number;
}

/**
 * Append r zeros, divide by g(x), and take the remainder as the FCS.
 *
 * Why append zeros: it shifts the message up by x^r, leaving exactly r low-order slots
 * free for the remainder. The resulting codeword is then divisible by g(x) by
 * construction, which is what the receiver checks.
 */
export function crcGenerate(message: Bits, generator: Bits): CrcResult {
  const gen = normalize(generator);
  if (isZero(gen)) throw new Error('Generator polynomial cannot be zero');
  const width = gen.length - 1;
  if (width < 1) throw new Error('Generator polynomial must have degree >= 1');

  const augmented: Bits = [...message, ...(Array(width).fill(0) as Bits)];
  const division = polyDivideSteps(augmented, gen);
  const fcs = padLeft(division.remainder, width);

  return {
    message: message.slice(),
    augmented,
    fcs,
    codeword: [...message, ...fcs],
    division,
    width,
  };
}

export interface CrcVerifyResult {
  /** True when the remainder is all zeros, i.e. no error detected. */
  ok: boolean;
  /** The remainder — nonzero acts as an error syndrome. */
  remainder: Bits;
  /** The message portion (codeword minus the trailing r bits). */
  message: Bits;
  /** The FCS carried by the frame. */
  fcs: Bits;
  division: DivisionResult;
  width: number;
}

/**
 * Divide the received codeword by g(x). A zero remainder means "no error detected" —
 * which is not the same as "no error": undetectable errors are exactly those where the
 * error pattern is itself a multiple of g(x).
 */
export function crcVerify(codeword: Bits, generator: Bits): CrcVerifyResult {
  const gen = normalize(generator);
  const width = gen.length - 1;
  if (codeword.length < width) {
    throw new Error(`Codeword (${codeword.length} bits) is shorter than the FCS (${width} bits)`);
  }
  const division = polyDivideSteps(codeword, gen);
  const remainder = padLeft(division.remainder, width);

  return {
    ok: isZero(remainder),
    remainder,
    message: codeword.slice(0, codeword.length - width),
    fcs: codeword.slice(codeword.length - width),
    division,
    width,
  };
}

/**
 * Longest burst error guaranteed to be caught, and the escape probabilities just past it.
 *
 * A burst of length L is an error pattern spanning L bits whose first and last bits are
 * flipped. Such a pattern is E(x) = x^i · b(x) with deg(b) = L-1. Since g(x) has a
 * nonzero constant term it cannot divide x^i, so detection turns on whether g(x) divides
 * b(x) — impossible when L-1 < r.
 */
export function burstGuarantees(width: number): {
  alwaysDetected: number;
  escapeAtRPlus1: number;
  escapeBeyond: number;
} {
  return {
    alwaysDetected: width,
    // L = r+1: b(x) must equal g(x) exactly (both ends fixed at 1) -> 1 of 2^(r-1) patterns.
    escapeAtRPlus1: width > 1 ? Math.pow(2, -(width - 1)) : 1,
    // L > r+1: the free middle bits give 2^-r.
    escapeBeyond: Math.pow(2, -width),
  };
}
