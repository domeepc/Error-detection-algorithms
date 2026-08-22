/**
 * Blind spots — error patterns a scheme cannot see.
 *
 * Every scheme here has a characterisable failure set, and knowing it is the point: an
 * error is undetectable exactly when the error pattern is itself a valid "zero" for the
 * scheme's arithmetic. This module builds those patterns from theory and then **verifies
 * each one by running the scheme's own checker**, so nothing reaches the UI on the strength
 * of an argument alone.
 *
 * The important and non-obvious case is CRC. The tempting answer — "g(x) shifted, so weight
 * = popcount(g)" — is correct but not minimal. The true minimum for a short frame comes from
 * the polynomial's *period*: the smallest p with x^p ≡ 1 (mod g). Two bits p apart form
 * x^i·(x^p + 1) ≡ 0 and cancel exactly, giving a weight-2 blind spot whenever p fits inside
 * the frame. That is the real criterion for matching a polynomial to a frame size, and it is
 * why CRC-16 (period 32767) is specified for frames up to about 4 KB.
 */

import { type Bit, type Bits, chunk, isZero, normalize, bitsToString, weight } from './gf2';
import { crcGenerate, crcVerify } from './crc';
import { buildParityBlock, checkParityBlock, type ParityBlock } from './vrclrc';
import { checksumFromBits, verifyFromBits } from './checksum';
import {
  applyPattern,
  patternFromIndices,
  indicesFromPattern,
  type SchemeId,
} from './errors';

export type { SchemeId };

export type BlindSpotOrigin =
  | 'period'
  | 'shifted-g'
  | 'row-pair'
  | 'column-pair'
  | 'rectangle'
  | 'cancelling-pair'
  | 'word-swap';

export interface BlindSpot {
  scheme: SchemeId;
  weight: number;
  pattern: Bits;
  indices: number[];
  origin: BlindSpotOrigin;
  /** One line saying why this pattern is invisible to this scheme. */
  explanation: string;
}

/** Everything a verifier needs; mirrors how the error lab frames the data. */
export interface FrameContext {
  /** Data bits, already zero-padded to a whole number of units. */
  bits: Bits;
  /** Bits per unit — one parity row and one checksum word. */
  unitWidth: number;
  /** CRC generator, or null when none is selected. */
  generator: Bits | null;
}

/* ------------------------------------------------------------------ *
 * Verifiers — the scheme's real check, not a re-derivation
 * ------------------------------------------------------------------ */

function sentBlock(ctx: FrameContext): ParityBlock {
  return buildParityBlock(chunk(ctx.bits, ctx.unitWidth), {
    parity: 'even',
    bitsPerRow: ctx.unitWidth,
  });
}

/**
 * Does `pattern` slip past `scheme` unnoticed?
 *
 * Errors are injected into the data portion only, with the transmitted check value kept —
 * exactly what the error lab does, and what makes the CRC analysis below apply directly.
 */
export function isUndetected(scheme: SchemeId, ctx: FrameContext, pattern: Bits): boolean {
  if (isZero(pattern)) return false; // an absent error is not a blind spot
  const corrupted = applyPattern(ctx.bits, pattern);

  switch (scheme) {
    case 'crc': {
      if (!ctx.generator) return false;
      const fcs = crcGenerate(ctx.bits, ctx.generator).fcs;
      return crcVerify([...corrupted, ...fcs], ctx.generator).ok;
    }
    case 'vrc':
    case 'lrc':
    case 'vrc+lrc': {
      const sent = sentBlock(ctx);
      const received: ParityBlock = { ...sent, rows: chunk(corrupted, ctx.unitWidth) };
      const check = checkParityBlock(received);
      if (scheme === 'vrc') return check.badRows.length === 0;
      if (scheme === 'lrc') return check.badColumns.length === 0;
      return check.ok;
    }
    case 'checksum': {
      const sum = checksumFromBits(ctx.bits, 'internet', { wordBits: ctx.unitWidth });
      return verifyFromBits(corrupted, sum.checksum, 'internet', { wordBits: ctx.unitWidth }).ok;
    }
  }
}

/** Build a candidate, verify it, and keep it only if it genuinely passes. */
function candidate(
  scheme: SchemeId,
  ctx: FrameContext,
  indices: number[],
  origin: BlindSpotOrigin,
  explanation: string,
): BlindSpot | null {
  if (indices.length === 0) return null;
  if (indices.some((i) => i < 0 || i >= ctx.bits.length)) return null;
  const pattern = patternFromIndices(ctx.bits.length, indices);
  if (!isUndetected(scheme, ctx, pattern)) return null;
  return {
    scheme,
    weight: weight(pattern),
    pattern,
    indices: indicesFromPattern(pattern),
    origin,
    explanation,
  };
}

/* ------------------------------------------------------------------ *
 * CRC — period and shifted generator
 * ------------------------------------------------------------------ */

export const DEFAULT_PERIOD_CAP = 100_000;

/**
 * Smallest p > 0 with x^p ≡ 1 (mod g), or null if none below `cap`.
 *
 * Computed by repeatedly multiplying the running remainder by x and reducing — the same
 * shift-and-XOR step the hardware register performs, so no polynomial factorisation is
 * needed. A null result means "larger than cap", never "does not exist"; the caller must
 * phrase it that way.
 */
export function polynomialPeriod(generator: Bits, cap = DEFAULT_PERIOD_CAP): number | null {
  const g = normalize(generator);
  const r = g.length - 1;
  if (r < 1) return null;
  // g must have a nonzero constant term for x to be invertible mod g; every usable CRC
  // polynomial does, but a hand-entered one might not.
  if (g[g.length - 1] === 0) return null;

  // Start at x^0 = 1, held in the low position.
  let cur: Bits = Array(r).fill(0) as Bits;
  cur[r - 1] = 1;

  for (let p = 1; p <= cap; p++) {
    const overflow = cur[0];
    cur = [...cur.slice(1), 0] as Bits;
    if (overflow) {
      for (let j = 1; j < g.length; j++) cur[j - 1] = (cur[j - 1] ^ g[j]) as Bit;
    }
    if (cur[r - 1] === 1 && cur.slice(0, r - 1).every((b) => b === 0)) return p;
  }
  return null;
}

export interface CrcBlindSpotReport {
  period: number | null;
  periodCap: number;
  /** True when the frame is long enough for a two-bit blind spot to exist. */
  periodFitsFrame: boolean;
  generatorWeight: number;
  spots: BlindSpot[];
}

export function crcBlindSpots(ctx: FrameContext, cap = DEFAULT_PERIOD_CAP): CrcBlindSpotReport {
  const spots: BlindSpot[] = [];
  if (!ctx.generator) {
    return { period: null, periodCap: cap, periodFitsFrame: false, generatorWeight: 0, spots };
  }

  const g = normalize(ctx.generator);
  const n = ctx.bits.length;
  const period = polynomialPeriod(g, cap);
  const periodFitsFrame = period !== null && period < n;

  // --- weight 2: two bits exactly `period` apart --------------------------
  if (period !== null && periodFitsFrame) {
    const spot = candidate(
      'crc',
      ctx,
      [0, period],
      'period',
      `x^${period} ≡ 1 (mod g), so two bits ${period} apart form x^i·(x^${period} + 1), ` +
        `an exact multiple of g(x). The remainder is unchanged.`,
    );
    if (spot) spots.push(spot);
  }

  // --- weight popcount(g): the generator itself, at any offset -------------
  if (g.length <= n) {
    const spot = candidate(
      'crc',
      ctx,
      indicesFromPattern([...g, ...(Array(n - g.length).fill(0) as Bits)] as Bits),
      'shifted-g',
      `The error pattern is g(x) itself, which divides by g(x) with no remainder. ` +
        `Any shift of it works equally well.`,
    );
    if (spot) spots.push(spot);
  }

  return { period, periodCap: cap, periodFitsFrame, generatorWeight: weight(g), spots };
}

/* ------------------------------------------------------------------ *
 * Parity — row pairs, column pairs, rectangles
 * ------------------------------------------------------------------ */

export function parityBlindSpots(ctx: FrameContext): BlindSpot[] {
  const out: BlindSpot[] = [];
  const cols = ctx.unitWidth;
  const rows = Math.floor(ctx.bits.length / cols);

  // VRC: two flips in one row keep that row's parity even.
  if (cols >= 2) {
    const spot = candidate(
      'vrc',
      ctx,
      [0, 1],
      'row-pair',
      'Two flips in the same row change its bit count by two, so row parity is unchanged. ' +
        'Column parity still catches this one.',
    );
    if (spot) out.push(spot);
  }

  // LRC: two flips in one column keep that column's parity even.
  if (rows >= 2) {
    const spot = candidate(
      'lrc',
      ctx,
      [0, cols],
      'column-pair',
      'Two flips in the same column change its bit count by two, so column parity is ' +
        'unchanged. Row parity still catches this one.',
    );
    if (spot) out.push(spot);
  }

  // VRC + LRC: the four corners of a rectangle defeat both at once.
  if (rows >= 2 && cols >= 2) {
    const c2 = Math.min(cols - 1, 4);
    const spot = candidate(
      'vrc+lrc',
      ctx,
      [0, c2, cols, cols + c2],
      'rectangle',
      'Four flips at the corners of a rectangle give every affected row AND every affected ' +
        'column exactly two errors, so both parities survive. This is the smallest pattern ' +
        'that defeats two-dimensional parity.',
    );
    if (spot) out.push(spot);
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Checksum — anything that cancels in the sum
 * ------------------------------------------------------------------ */

export function checksumBlindSpots(ctx: FrameContext): BlindSpot[] {
  const out: BlindSpot[] = [];
  const w = ctx.unitWidth;
  const rows = chunk(ctx.bits, w);
  if (rows.length < 2) return out;

  // --- weight 2: +2^k in one word, -2^k in another ------------------------
  // Needs a bit offset where one word has a 0 (so it can go up) and another has a 1
  // (so it can come down); the two deltas then cancel exactly.
  outer: for (let k = 0; k < w; k++) {
    let zeroWord = -1;
    let oneWord = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][k] === 0 && zeroWord === -1) zeroWord = i;
      if (rows[i][k] === 1 && oneWord === -1) oneWord = i;
    }
    if (zeroWord === -1 || oneWord === -1) continue;
    const bitValue = Math.pow(2, w - 1 - k);
    const spot = candidate(
      'checksum',
      ctx,
      [zeroWord * w + k, oneWord * w + k],
      'cancelling-pair',
      `Word ${zeroWord + 1} gains ${bitValue} and word ${oneWord + 1} loses ${bitValue}. ` +
        `The two changes cancel, so the sum — and therefore the checksum — is untouched.`,
    );
    if (spot) {
      out.push(spot);
      break outer;
    }
  }

  // --- word swap: addition is commutative ---------------------------------
  for (let a = 0; a < rows.length - 1; a++) {
    for (let b = a + 1; b < rows.length; b++) {
      if (bitsToString(rows[a]) === bitsToString(rows[b])) continue;
      const indices: number[] = [];
      for (let k = 0; k < w; k++) {
        if (rows[a][k] !== rows[b][k]) {
          indices.push(a * w + k, b * w + k);
        }
      }
      const spot = candidate(
        'checksum',
        ctx,
        indices,
        'word-swap',
        `Words ${a + 1} and ${b + 1} are exchanged. Addition is commutative, so reordering ` +
          `words cannot change the sum at all — no matter how many bits differ.`,
      );
      if (spot) {
        out.push(spot);
        return out;
      }
    }
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Whole-frame report
 * ------------------------------------------------------------------ */

export interface SchemeReport {
  scheme: SchemeId;
  label: string;
  /** Constructive blind spots, all verified. */
  spots: BlindSpot[];
  /** Set when nothing was found and the reason is structural rather than a failed search. */
  note: string | null;
}

export const SCHEME_LABELS: Record<SchemeId, string> = {
  crc: 'CRC',
  vrc: 'VRC (row parity)',
  lrc: 'LRC (column parity)',
  'vrc+lrc': 'VRC + LRC combined',
  checksum: 'Internet checksum',
};

/** Full catalogue for one frame. */
export function blindSpotReport(
  ctx: FrameContext,
  opts: { periodCap?: number } = {},
): { schemes: SchemeReport[]; crc: CrcBlindSpotReport } {
  const crc = crcBlindSpots(ctx, opts.periodCap ?? DEFAULT_PERIOD_CAP);
  const parity = parityBlindSpots(ctx);
  const checksum = checksumBlindSpots(ctx);

  const byScheme = (id: SchemeId): BlindSpot[] =>
    [...crc.spots, ...parity, ...checksum]
      .filter((s) => s.scheme === id)
      .sort((a, b) => a.weight - b.weight);

  const schemes: SchemeReport[] = (
    ['crc', 'vrc', 'lrc', 'vrc+lrc', 'checksum'] as SchemeId[]
  ).map((id) => {
    const spots = byScheme(id);
    let note: string | null = null;

    if (id === 'crc') {
      if (!ctx.generator) {
        note = 'No generator polynomial selected.';
      } else if (crc.period === null) {
        note =
          `The period of g(x) exceeds ${(opts.periodCap ?? DEFAULT_PERIOD_CAP).toLocaleString()}, ` +
          `so no two-bit blind spot exists for any frame this side of that length.`;
      } else if (!crc.periodFitsFrame) {
        note =
          `The period of g(x) is ${crc.period.toLocaleString()}, longer than this ` +
          `${ctx.bits.length}-bit frame — so no two bits in it can cancel. A weight-2 blind ` +
          `spot needs a frame longer than ${crc.period.toLocaleString()} bits.`;
      }
    }

    return {
      scheme: id,
      label: SCHEME_LABELS[id],
      spots,
      note,
    };
  });

  return { schemes, crc };
}
