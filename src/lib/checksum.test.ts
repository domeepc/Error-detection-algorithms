import { describe, it, expect } from 'vitest';
import {
  toHex,
  checksumFromBits,
  verifyFromBits,
  bitsToWords,
  toBinaryString,
  MIN_WORD_BITS,
  MAX_WORD_BITS,
  type ChecksumMode,
  type ChecksumOptions,
} from './checksum';
import { textToBytes, stringToBits, bytesToBits, bitsToString, type Bits } from './gf2';

// The byte-oriented wrappers were one-liners over these two; the tests call them directly.
const sumBytes = (bytes: number[], mode: ChecksumMode = 'internet', opts: ChecksumOptions = {}) =>
  checksumFromBits(bytesToBits(bytes), mode, opts);
const verifyBytes = (
  bytes: number[],
  checksum: number,
  mode: ChecksumMode = 'internet',
  opts: ChecksumOptions = {},
) => verifyFromBits(bytesToBits(bytes), checksum, mode, opts);

describe('internetChecksum (RFC 1071)', () => {
  it('matches the worked example from RFC 1071', () => {
    // The RFC's example octets 00 01 f2 03 f4 f5 f6 f7 sum to 0xddf2, checksum 0x220d.
    const bytes = [0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5, 0xf6, 0xf7];
    const result = sumBytes(bytes);
    expect(result.sum).toBe(0xddf2);
    expect(result.checksum).toBe(0x220d);
  });

  it('verifies to 0xFFFF when the checksum is included', () => {
    const bytes = textToBytes('The quick brown fox');
    const { checksum } = sumBytes(bytes);
    const check = verifyBytes(bytes, checksum);
    expect(check.ok).toBe(true);
    expect(check.total).toBe(0xffff);
  });

  it('pads an odd trailing byte', () => {
    const result = sumBytes([0x12, 0x34, 0x56]);
    expect(result.padded).toBe(true);
    expect(result.words).toEqual([0x1234, 0x5600]);
  });

  it('is insensitive to word order, thanks to end-around carry', () => {
    const a = sumBytes([0xff, 0xff, 0x00, 0x01, 0x12, 0x34]);
    const b = sumBytes([0x12, 0x34, 0xff, 0xff, 0x00, 0x01]);
    expect(a.checksum).toBe(b.checksum);
  });

  it('records a carry fold when the running sum overflows', () => {
    const result = sumBytes([0xff, 0xff, 0xff, 0xff]);
    expect(result.steps.some((s) => s.carried)).toBe(true);
    expect(result.steps.every((s) => s.after <= 0xffff)).toBe(true);
  });

  it('detects any single-bit error', () => {
    const bytes = textToBytes('checksum coverage');
    const { checksum } = sumBytes(bytes);
    for (let i = 0; i < bytes.length; i++) {
      for (let b = 0; b < 8; b++) {
        const corrupted = [...bytes];
        corrupted[i] ^= 1 << b;
        expect(verifyBytes(corrupted, checksum).ok, `byte ${i} bit ${b}`).toBe(false);
      }
    }
  });

  it('is fooled by a compensating pair of errors', () => {
    // Adding 1 to one word and subtracting 1 from another leaves the sum untouched —
    // the structural weakness of any additive checksum.
    const bytes = [0x00, 0x10, 0x00, 0x20, 0x00, 0x30];
    const { checksum } = sumBytes(bytes);
    const corrupted = [...bytes];
    corrupted[1] += 1;
    corrupted[3] -= 1;
    expect(corrupted).not.toEqual(bytes);
    expect(verifyBytes(corrupted, checksum).ok).toBe(true);
  });

  it('misses a pure word-swap, since addition is commutative', () => {
    const bytes = [0x12, 0x34, 0xab, 0xcd];
    const swapped = [0xab, 0xcd, 0x12, 0x34];
    expect(sumBytes(bytes).checksum).toBe(sumBytes(swapped).checksum);
  });
});

describe('modularChecksum', () => {
  it('sums bytes mod 256 and complements', () => {
    const result = sumBytes([0x01, 0x02, 0x03], 'modular');
    expect(result.sum).toBe(0x06);
    expect(result.checksum).toBe(0xf9); // ~0x06 & 0xFF
    // The defining property: data sum + checksum saturates the word.
    expect((result.sum + result.checksum) & 0xff).toBe(0xff);
  });

  it('verifies back to the mask', () => {
    const bytes = textToBytes('modular');
    const { checksum } = sumBytes(bytes, 'modular');
    expect(verifyBytes(bytes, checksum, 'modular').ok).toBe(true);
  });

  it('can skip the complement', () => {
    const result = sumBytes([0x01, 0x02, 0x03], 'modular', { complement: false });
    expect(result.checksum).toBe(0x06);
    expect(verifyBytes([0x01, 0x02, 0x03], 0x06, 'modular', { complement: false }).ok).toBe(true);
  });

  it('discards carries rather than folding them', () => {
    // 0xFF + 0xFF = 0x1FE -> 0xFE with the carry dropped.
    const result = sumBytes([0xff, 0xff], 'modular', { complement: false });
    expect(result.sum).toBe(0xfe);
    expect(result.steps[1].carried).toBe(true);
  });

  it('groups bits into words of the chosen width', () => {
    // Word width sets the grouping as well as the modulus, so two bytes at 16 bits are
    // one word 0xFFFF — not two bytes summed into a 16-bit accumulator.
    const wide = sumBytes([0xff, 0xff], 'modular', { wordBits: 16, complement: false });
    expect(wide.words).toEqual([0xffff]);
    expect(wide.sum).toBe(0xffff);

    const narrow = sumBytes([0xff, 0xff], 'modular', { wordBits: 8, complement: false });
    expect(narrow.words).toEqual([0xff, 0xff]);
    expect(narrow.sum).toBe(0xfe); // carry discarded
  });

  it('detects a random single-byte change most of the time', () => {
    const bytes = textToBytes('a modest amount of payload text');
    const { checksum } = sumBytes(bytes, 'modular');
    let detected = 0;
    const trials = 300;
    for (let t = 0; t < trials; t++) {
      const corrupted = [...bytes];
      const i = Math.floor(Math.random() * corrupted.length);
      const delta = 1 + Math.floor(Math.random() * 255);
      corrupted[i] = (corrupted[i] + delta) & 0xff;
      if (!verifyBytes(corrupted, checksum, 'modular').ok) detected++;
    }
    // Any single-byte change shifts the sum, so all of them are caught.
    expect(detected).toBe(trials);
  });
});

describe('arbitrary word widths', () => {
  it('works at every width from 2 to 32', () => {
    const bits = stringToBits('110100111000101101011100011110101');
    for (let w = MIN_WORD_BITS; w <= MAX_WORD_BITS; w++) {
      for (const mode of ['internet', 'modular'] as const) {
        const r = checksumFromBits(bits, mode, { wordBits: w });
        expect(r.wordBits, `${mode}/${w}`).toBe(w);
        expect(r.checksumBinary.length, `${mode}/${w}`).toBe(w);
        expect(r.checksum, `${mode}/${w}`).toBeLessThan(Math.pow(2, w));
        expect(r.checksum).toBeGreaterThanOrEqual(0);
        // Round-trip: the frame it produces must verify.
        expect(verifyFromBits(bits, r.checksum, mode, { wordBits: w }).ok, `${mode}/${w}`).toBe(true);
      }
    }
  });

  it('stays correct at 32 bits, where signed bitwise ops would break', () => {
    const bits = [...stringToBits('1'.repeat(64))] as Bits;
    const r = checksumFromBits(bits, 'internet', { wordBits: 32 });
    expect(r.words).toEqual([0xffffffff, 0xffffffff]);
    // Every intermediate stays a non-negative unsigned value.
    for (const s of r.steps) expect(s.after).toBeGreaterThanOrEqual(0);
    expect(r.checksum).toBeGreaterThanOrEqual(0);
    expect(verifyFromBits(bits, r.checksum, 'internet', { wordBits: 32 }).ok).toBe(true);
  });

  it('rejects widths outside 2-32', () => {
    const bits = stringToBits('1010');
    for (const w of [0, 1, 33, 64, 2.5, -8]) {
      expect(() => checksumFromBits(bits, 'internet', { wordBits: w }), `w=${w}`).toThrow(/Word width/);
    }
  });
});

describe('zero padding', () => {
  it('pads the tail so the data fills whole words', () => {
    // 10 bits at width 4 -> pad 2 -> 3 words
    const r = checksumFromBits(stringToBits('1011001110'), 'modular', { wordBits: 4 });
    expect(r.padBits).toBe(2);
    expect(r.padded).toBe(true);
    expect(r.paddedBits).toHaveLength(12);
    expect(bitsToString(r.paddedBits)).toBe('101100111000');
    expect(r.wordsBinary).toEqual(['1011', '0011', '1000']);
  });

  it('pads on the right, preserving each word s place value', () => {
    const r = checksumFromBits(stringToBits('1'), 'modular', { wordBits: 8 });
    // A single 1 bit is the top of the word, not the bottom.
    expect(r.wordsBinary).toEqual(['10000000']);
    expect(r.padBits).toBe(7);
  });

  it('reports no padding when the data already fits', () => {
    const r = checksumFromBits(stringToBits('10110011'), 'modular', { wordBits: 4 });
    expect(r.padBits).toBe(0);
    expect(r.padded).toBe(false);
  });

  it('matches RFC 1071 odd-byte padding', () => {
    const r = sumBytes([0x12, 0x34, 0x56]);
    expect(r.padded).toBe(true);
    expect(r.padBits).toBe(8);
    expect(r.words).toEqual([0x1234, 0x5600]);
  });

  it('bitsToWords is consistent with the checksum result', () => {
    const bits = stringToBits('11010011100');
    const { words, padBits } = bitsToWords(bits, 5);
    const r = checksumFromBits(bits, 'modular', { wordBits: 5 });
    expect(r.words).toEqual(words);
    expect(r.padBits).toBe(padBits);
  });
});

describe('binary rendering', () => {
  it('renders every word and the checksum at full width', () => {
    const r = checksumFromBits(stringToBits('101100111000'), 'internet', { wordBits: 6 });
    expect(r.wordsBinary).toEqual(['101100', '111000']);
    for (const b of r.wordsBinary) expect(b).toMatch(/^[01]{6}$/);
    expect(r.sumBinary).toMatch(/^[01]{6}$/);
    expect(r.checksumBinary).toMatch(/^[01]{6}$/);
  });

  it('toBinaryString pads narrow values', () => {
    expect(toBinaryString(5, 8)).toBe('00000101');
    expect(toBinaryString(0, 4)).toBe('0000');
    expect(toBinaryString(0xffffffff, 32)).toBe('1'.repeat(32));
  });

  it('checksum binary is the complement of the sum binary', () => {
    const r = checksumFromBits(stringToBits('101100111000'), 'internet', { wordBits: 6 });
    const flipped = [...r.sumBinary].map((c) => (c === '1' ? '0' : '1')).join('');
    expect(r.checksumBinary).toBe(flipped);
  });
});

describe('verification method', () => {
  it('uses sum-including-checksum when complemented', () => {
    const bits = stringToBits('1011001110001111');
    const r = checksumFromBits(bits, 'internet', { wordBits: 8 });
    const v = verifyFromBits(bits, r.checksum, 'internet', { wordBits: 8 });
    expect(v.method).toBe('sum-including-checksum');
    expect(v.expectedBinary).toBe('11111111');
    expect(v.ok).toBe(true);
  });

  it('recomputes and compares when not complemented', () => {
    const bits = stringToBits('1011001110001111');
    const r = checksumFromBits(bits, 'modular', { wordBits: 8, complement: false });
    const v = verifyFromBits(bits, r.checksum, 'modular', { wordBits: 8, complement: false });
    expect(v.method).toBe('recompute-and-compare');
    expect(v.ok).toBe(true);
  });

  it('catches corruption under both verification methods', () => {
    const bits = stringToBits('1011001110001111');
    for (const complement of [true, false]) {
      const r = checksumFromBits(bits, 'modular', { wordBits: 8, complement });
      const corrupted = [...bits] as Bits;
      corrupted[3] = (corrupted[3] ^ 1) as 0 | 1;
      expect(
        verifyFromBits(corrupted, r.checksum, 'modular', { wordBits: 8, complement }).ok,
        `complement=${complement}`,
      ).toBe(false);
    }
  });
});

describe('mode dispatch', () => {
  it('computeChecksum and verifyChecksum agree for both modes', () => {
    const bytes = textToBytes('dispatch');
    for (const mode of ['internet', 'modular'] as const) {
      const { checksum } = sumBytes(bytes, mode);
      expect(verifyBytes(bytes, checksum, mode).ok, mode).toBe(true);
    }
  });
});

describe('toHex', () => {
  it('pads to the word width', () => {
    expect(toHex(0x0d, 16)).toBe('0x000D');
    expect(toHex(0xfa, 8)).toBe('0xFA');
  });
});
