import { describe, it, expect } from 'vitest';
import {
  polynomialPeriod,
  crcBlindSpots,
  parityBlindSpots,
  checksumBlindSpots,
  isUndetected,
  blindSpotReport,
  type FrameContext,
} from './undetectable';
import { parsePolynomial, stringToBits, weight, type Bits } from './gf2';

const G3 = parsePolynomial('x^3 + x + 1').bits; // 1011, r=3
const G4 = parsePolynomial('x^4 + x + 1').bits; // 10011, r=4
const CRC8 = parsePolynomial('x^8 + x^2 + x + 1').bits; // 100000111, r=8
const CRC16_IBM = parsePolynomial('x^16 + x^15 + x^2 + 1').bits;
const CRC16_CCITT = parsePolynomial('x^16 + x^12 + x^5 + 1').bits;

function randomBits(n: number): Bits {
  return Array.from({ length: n }, () => (Math.random() < 0.5 ? 1 : 0)) as Bits;
}

function ctxFor(bitsStr: string, unitWidth: number, generator: Bits | null): FrameContext {
  return { bits: stringToBits(bitsStr), unitWidth, generator };
}

describe('polynomialPeriod', () => {
  it('matches known periods for the standard presets', () => {
    expect(polynomialPeriod(G3)).toBe(7);
    expect(polynomialPeriod(G4)).toBe(15);
    expect(polynomialPeriod(CRC8)).toBe(127);
    expect(polynomialPeriod(CRC16_IBM)).toBe(32767);
    expect(polynomialPeriod(CRC16_CCITT)).toBe(32767);
  });

  it('returns null when the period exceeds the cap, not a wrong answer', () => {
    const crc32 = parsePolynomial(
      'x^32 + x^26 + x^23 + x^22 + x^16 + x^12 + x^11 + x^10 + x^8 + x^7 + x^5 + x^4 + x^2 + x + 1',
    ).bits;
    expect(polynomialPeriod(crc32, 5000)).toBeNull();
  });

  it('confirms the period property directly: x^p ⊕ 1 is divisible by g', () => {
    // Cross-check against crcVerify itself, independent of the period algorithm.
    const g = G3;
    const p = polynomialPeriod(g)!;
    const n = p + 4;
    const pattern = Array(n).fill(0) as Bits;
    pattern[0] = 1;
    pattern[p] = 1;
    const message = Array(n).fill(0) as Bits;
    message[0] = 0; // message content is irrelevant to the property; use the pattern directly
    const ctx: FrameContext = { bits: message, unitWidth: 8, generator: g };
    // Two bits `period` apart must be undetected by CRC.
    expect(isUndetected('crc', ctx, pattern)).toBe(true);
  });

  it('rejects generators with degree < 1', () => {
    expect(polynomialPeriod([1])).toBeNull();
  });
});

describe('crcBlindSpots', () => {
  it('every reported spot is genuinely undetected', () => {
    for (const g of [G3, G4, CRC8, CRC16_CCITT]) {
      for (let trial = 0; trial < 5; trial++) {
        const n = g.length + 20 + Math.floor(Math.random() * 40);
        const ctx: FrameContext = { bits: randomBits(n), unitWidth: 8, generator: g };
        const report = crcBlindSpots(ctx, 40000);
        for (const spot of report.spots) {
          expect(isUndetected('crc', ctx, spot.pattern), spot.origin).toBe(true);
        }
      }
    }
  });

  it('finds the weight-2 period spot when the frame is long enough', () => {
    const ctx = ctxFor('0'.repeat(20), 8, G3); // period 7, frame 20 > 7
    const report = crcBlindSpots(ctx);
    expect(report.period).toBe(7);
    expect(report.periodFitsFrame).toBe(true);
    const periodSpot = report.spots.find((s) => s.origin === 'period');
    expect(periodSpot).toBeDefined();
    expect(periodSpot!.weight).toBe(2);
  });

  it('omits the weight-2 spot when the frame is shorter than the period', () => {
    const ctx = ctxFor('0'.repeat(6), 8, G3); // period 7, frame only 6 bits
    const report = crcBlindSpots(ctx);
    expect(report.periodFitsFrame).toBe(false);
    expect(report.spots.find((s) => s.origin === 'period')).toBeUndefined();
  });

  it('the shifted-g spot has weight equal to weight(g)', () => {
    const ctx = ctxFor('0'.repeat(20), 8, CRC8);
    const report = crcBlindSpots(ctx);
    const gSpot = report.spots.find((s) => s.origin === 'shifted-g');
    expect(gSpot).toBeDefined();
    expect(gSpot!.weight).toBe(weight(CRC8));
  });

  it('reports generatorWeight and an empty spot list without a generator', () => {
    const ctx: FrameContext = { bits: stringToBits('11001100'), unitWidth: 8, generator: null };
    const report = crcBlindSpots(ctx);
    expect(report.spots).toEqual([]);
    expect(report.period).toBeNull();
  });

  it('never returns a spot with an out-of-range index', () => {
    const ctx = ctxFor('101', 8, G4); // shorter than generator itself
    const report = crcBlindSpots(ctx);
    for (const spot of report.spots) {
      for (const i of spot.indices) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(ctx.bits.length);
      }
    }
  });
});

describe('parityBlindSpots', () => {
  const ctx = ctxFor('1101011011001010', 8, null); // 2 rows of 8

  it('every reported spot is genuinely undetected by its scheme', () => {
    for (const spot of parityBlindSpots(ctx)) {
      expect(isUndetected(spot.scheme, ctx, spot.pattern), spot.scheme).toBe(true);
    }
  });

  it('finds row-pair (VRC), column-pair (LRC), and rectangle (VRC+LRC)', () => {
    const origins = parityBlindSpots(ctx).map((s) => s.origin);
    expect(origins).toContain('row-pair');
    expect(origins).toContain('column-pair');
    expect(origins).toContain('rectangle');
  });

  it('the rectangle has weight 4, row/column pairs have weight 2', () => {
    const spots = parityBlindSpots(ctx);
    expect(spots.find((s) => s.origin === 'rectangle')!.weight).toBe(4);
    expect(spots.find((s) => s.origin === 'row-pair')!.weight).toBe(2);
    expect(spots.find((s) => s.origin === 'column-pair')!.weight).toBe(2);
  });

  it('omits the column-pair and rectangle for a single-row frame', () => {
    const single = ctxFor('11001100', 8, null);
    const origins = parityBlindSpots(single).map((s) => s.origin);
    expect(origins).toContain('row-pair');
    expect(origins).not.toContain('column-pair');
    expect(origins).not.toContain('rectangle');
  });

  it('works across random frames and widths', () => {
    for (let trial = 0; trial < 20; trial++) {
      const w = 5 + Math.floor(Math.random() * 6);
      const rows = 2 + Math.floor(Math.random() * 4);
      const ctx2 = { bits: randomBits(w * rows), unitWidth: w, generator: null };
      for (const spot of parityBlindSpots(ctx2)) {
        expect(isUndetected(spot.scheme, ctx2, spot.pattern), `${spot.origin} w=${w}`).toBe(true);
      }
    }
  });
});

describe('checksumBlindSpots', () => {
  it('every reported spot is genuinely undetected', () => {
    for (let trial = 0; trial < 20; trial++) {
      const w = 4 + Math.floor(Math.random() * 6);
      const rows = 2 + Math.floor(Math.random() * 4);
      const ctx: FrameContext = { bits: randomBits(w * rows), unitWidth: w, generator: null };
      for (const spot of checksumBlindSpots(ctx)) {
        expect(isUndetected('checksum', ctx, spot.pattern), spot.origin).toBe(true);
      }
    }
  });

  it('finds a weight-2 cancelling pair when words differ at some bit', () => {
    // word0 = 11100111 (has a 0 at index 3), word1 = 11011101 (has a 1 at index 3)
    const ctx = ctxFor('1110011111011101', 8, null);
    const spots = checksumBlindSpots(ctx);
    const pair = spots.find((s) => s.origin === 'cancelling-pair');
    expect(pair).toBeDefined();
    expect(pair!.weight).toBe(2);
  });

  it('finds a word-swap spot for two distinct words', () => {
    const ctx = ctxFor('1110011111011101', 8, null);
    const swap = checksumBlindSpots(ctx).find((s) => s.origin === 'word-swap');
    expect(swap).toBeDefined();
  });

  it('returns nothing for a single-word frame', () => {
    expect(checksumBlindSpots(ctxFor('11001100', 8, null))).toEqual([]);
  });

  it('skips the word-swap spot when all words are identical', () => {
    const ctx = ctxFor('1100110011001100', 8, null); // both words equal
    const swap = checksumBlindSpots(ctx).find((s) => s.origin === 'word-swap');
    expect(swap).toBeUndefined();
  });
});

describe('isUndetected', () => {
  it('a zero pattern is never a blind spot', () => {
    const ctx = ctxFor('11001100', 8, G3);
    const zero = Array(8).fill(0) as Bits;
    expect(isUndetected('crc', ctx, zero)).toBe(false);
    expect(isUndetected('checksum', ctx, zero)).toBe(false);
  });

  it('returns false for CRC with no generator', () => {
    const ctx: FrameContext = { bits: stringToBits('11001100'), unitWidth: 8, generator: null };
    const pattern = stringToBits('10000000');
    expect(isUndetected('crc', ctx, pattern)).toBe(false);
  });
});

describe('blindSpotReport', () => {
  it('produces a report for all five schemes', () => {
    const ctx = ctxFor('1101011011001010', 8, G3);
    const { schemes } = blindSpotReport(ctx);
    expect(schemes.map((s) => s.scheme)).toEqual(['crc', 'vrc', 'lrc', 'vrc+lrc', 'checksum']);
    for (const s of schemes) {
      for (const spot of s.spots) {
        expect(isUndetected(spot.scheme, ctx, spot.pattern)).toBe(true);
      }
    }
  });

  it('explains why CRC has no spot when the frame is shorter than the period', () => {
    const ctx = ctxFor('11001100', 8, CRC16_CCITT); // 8 bits, period 32767
    const { schemes } = blindSpotReport(ctx);
    const crc = schemes.find((s) => s.scheme === 'crc')!;
    expect(crc.spots.find((s) => s.origin === 'period')).toBeUndefined();
    expect(crc.note).toMatch(/32,?767/);
  });

  it('explains the missing CRC report when no generator is selected', () => {
    const ctx: FrameContext = { bits: stringToBits('11001100'), unitWidth: 8, generator: null };
    const { schemes } = blindSpotReport(ctx);
    expect(schemes.find((s) => s.scheme === 'crc')!.note).toMatch(/No generator/);
  });
});
