import { describe, it, expect } from 'vitest';
import {
  parsePolynomial,
  formatAlgebraic,
  formatHex,
  superscript,
  polyDivideSteps,
  polyMul,
  stringToBits,
  bitsToString,
  bytesToBits,
  bitsToBytes,
  xPow,
  degree,
  POLY_PRESETS,
} from './gf2';

describe('superscript', () => {
  it('renders each digit', () => {
    expect(superscript(0)).toBe('⁰');
    expect(superscript(16)).toBe('¹⁶');
    expect(superscript(32767)).toBe('³²⁷⁶⁷');
  });
});

describe('formatAlgebraicUnicode', () => {
  it('matches formatAlgebraic term-for-term, with superscripts instead of carets', () => {
    for (const preset of POLY_PRESETS) {
      const bits = parsePolynomial(preset.algebraic).bits;
      const caret = formatAlgebraic(bits);
      const unicode = formatAlgebraic(bits, true);
      // Same terms, same "+" joins, only the exponent notation differs.
      expect(unicode.split(' + ').length, preset.label).toBe(caret.split(' + ').length);
      expect(unicode, preset.label).not.toMatch(/\^/);
    }
  });

  it('renders a known polynomial exactly', () => {
    const bits = parsePolynomial('x^16 + x^12 + x^5 + 1').bits;
    expect(formatAlgebraic(bits, true)).toBe('x¹⁶ + x¹² + x⁵ + 1');
  });

  it('leaves x^1 and x^0 in their special forms, same as formatAlgebraic', () => {
    const bits = parsePolynomial('x^3 + x + 1').bits;
    expect(formatAlgebraic(bits, true)).toBe('x³ + x + 1');
  });

  it('renders the zero polynomial the same as formatAlgebraic', () => {
    expect(formatAlgebraic([0], true)).toBe('0');
    expect(formatAlgebraic([0], true)).toBe(formatAlgebraic([0]));
  });
});

describe('parsePolynomial', () => {
  it('parses algebraic notation', () => {
    const p = parsePolynomial('x^3 + x + 1');
    expect(bitsToString(p.bits)).toBe('1011');
    expect(p.degree).toBe(3);
    expect(p.terms).toEqual([3, 1, 0]);
  });

  it('parses binary notation', () => {
    expect(bitsToString(parsePolynomial('10011').bits)).toBe('10011');
  });

  it('reads hex literally when no width is given', () => {
    // 0x1021 alone is x^12 + x^5 + 1 — the x^16 term is not recoverable from the value.
    expect(parsePolynomial('0x1021').degree).toBe(12);
  });

  it('restores the implicit top bit when hexWidth is supplied', () => {
    const p = parsePolynomial('0x1021', { hexWidth: 16 });
    expect(p.degree).toBe(16);
    expect(formatAlgebraic(p.bits)).toBe('x^16 + x^12 + x^5 + 1');
  });

  it('restores the top bit for narrow constants like CRC-8', () => {
    expect(formatAlgebraic(parsePolynomial('0x07', { hexWidth: 8 }).bits)).toBe('x^8 + x^2 + x + 1');
  });

  it('rejects a hex value too wide for the stated width', () => {
    expect(() => parsePolynomial('0x11021', { hexWidth: 16 })).toThrow(/does not fit/);
  });

  it('cancels repeated terms over GF(2)', () => {
    expect(bitsToString(parsePolynomial('x^2 + x + x + 1').bits)).toBe('101');
  });

  it('tolerates unicode superscripts', () => {
    expect(bitsToString(parsePolynomial('x³ + x + 1').bits)).toBe('1011');
  });

  it('rejects garbage', () => {
    expect(() => parsePolynomial('hello')).toThrow();
    expect(() => parsePolynomial('')).toThrow();
  });

  it('round-trips every preset through algebraic and hex formatting', () => {
    for (const preset of POLY_PRESETS) {
      const p = parsePolynomial(preset.algebraic);
      expect(p.degree, preset.label).toBe(preset.width);
      expect(formatAlgebraic(p.bits), preset.label).toBe(preset.algebraic);
      // The preset's hex string is the conventional width-implicit form.
      expect(formatHex(parsePolynomial(preset.hex, { hexWidth: preset.width }).bits).toLowerCase())
        .toBe(formatHex(p.bits).toLowerCase());
    }
  });
});

describe('polyDivideSteps', () => {
  it('matches the classic Tanenbaum worked example', () => {
    // M = 1101011011, G = 10011 (x^4 + x + 1) -> remainder 1110
    const g = stringToBits('10011');
    const augmented = stringToBits('1101011011' + '0000');
    const { remainder } = polyDivideSteps(augmented, g);
    expect(bitsToString(remainder)).toBe('1110');
  });

  it('produces a zero remainder for the transmitted codeword', () => {
    const g = stringToBits('10011');
    const codeword = stringToBits('11010110111110');
    expect(bitsToString(polyDivideSteps(codeword, g).remainder)).toBe('0000');
  });

  it('always returns a remainder exactly deg(g) bits wide', () => {
    const g = stringToBits('100000111'); // degree 8
    for (const msg of ['1', '0', '11111111', '1010101010101010']) {
      const r = polyDivideSteps(stringToBits(msg + '00000000'), g).remainder;
      expect(r.length).toBe(8);
    }
  });

  it('records one step per quotient position', () => {
    const g = stringToBits('1011');
    const dividend = stringToBits('1101011011000');
    const { steps, quotient } = polyDivideSteps(dividend, g);
    expect(steps.length).toBe(dividend.length - g.length + 1);
    expect(quotient.length).toBe(steps.length);
  });

  it('keeps before/after consistent with the quotient bit', () => {
    const g = stringToBits('10011');
    const { steps } = polyDivideSteps(stringToBits('110101101100001111'), g);
    for (const step of steps) {
      if (step.quotientBit === 0) {
        expect(step.after).toEqual(step.before);
        expect(step.subtrahend).toBeNull();
      } else {
        expect(step.subtrahend).not.toBeNull();
        // after == before XOR subtrahend, elementwise
        const expected = step.before.map((b, i) => b ^ step.subtrahend![i]);
        expect(step.after).toEqual(expected);
      }
    }
  });

  it('satisfies dividend = quotient*generator + remainder', () => {
    const g = stringToBits('100011011');
    const dividend = stringToBits('110101101100001111010101');
    const { quotient, remainder } = polyDivideSteps(dividend, g);
    const product = polyMul(quotient, g);
    const width = dividend.length;
    const lhs = dividend;
    const rhs = padTo(product, width).map((b, i) => b ^ padTo(remainder, width)[i]);
    expect(rhs).toEqual(lhs);
  });

  it('throws on a zero generator', () => {
    expect(() => polyDivideSteps(stringToBits('1010'), [0, 0])).toThrow();
  });
});

describe('polyMul / xPow', () => {
  it('multiplies over GF(2) without carries', () => {
    // (x + 1)(x + 1) = x^2 + 1 over GF(2), not x^2 + 2x + 1
    expect(bitsToString(polyMul(stringToBits('11'), stringToBits('11')))).toBe('101');
  });

  it('xPow builds x^n', () => {
    expect(bitsToString(xPow(5))).toBe('100000');
    expect(degree(xPow(5))).toBe(5);
  });
});

describe('byte/bit conversion', () => {
  it('round-trips bytes', () => {
    const bytes = [0x00, 0x41, 0xff, 0x7f, 0x80];
    expect(bitsToBytes(bytesToBits(bytes))).toEqual(bytes);
  });

  it('lays out bits MSB-first', () => {
    expect(bitsToString(bytesToBits([0x41]))).toBe('01000001');
  });
});

function padTo(bits: number[], width: number): number[] {
  return [...Array(Math.max(0, width - bits.length)).fill(0), ...bits].slice(-width);
}
