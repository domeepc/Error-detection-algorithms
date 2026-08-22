import { describe, it, expect } from 'vitest';
import {
  buildGeneratorMatrix,
  encode,
  syndrome,
  minimumDistance,
  encodeSteps,
  matMul,
  transpose,
  isZeroMatrix,
  type Matrix,
} from './generator-matrix';
import { crcGenerate } from './crc';
import { parsePolynomial, stringToBits, bitsToString, type Bits } from './gf2';

const G_741 = stringToBits('1011'); // x^3 + x + 1 -> the (7,4) cyclic code

describe('matrix helpers', () => {
  it('multiplies over GF(2) with XOR addition', () => {
    // 1+1 = 0, so the product of two all-ones matrices is all zeros for even inner dim.
    const ones = [
      [1, 1],
      [1, 1],
    ] as Bits[];
    expect(isZeroMatrix(matMul(ones, ones))).toBe(true);
  });

  const identity = (n: number): Matrix =>
    Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)) as Bits);

  it('identity is a multiplicative unit', () => {
    const m = [
      [1, 0, 1],
      [0, 1, 1],
    ] as Bits[];
    expect(matMul(m, identity(3))).toEqual(m);
  });

  it('transposes', () => {
    expect(transpose([[1, 0, 1]] as Bits[])).toEqual([[1], [0], [1]]);
  });

  it('rejects a dimension mismatch', () => {
    expect(() => matMul([[1, 0]] as Bits[], [[1, 0]] as Bits[])).toThrow(/Cannot multiply/);
  });
});

describe('buildGeneratorMatrix', () => {
  it('derives the (7,4) cyclic code from x^3 + x + 1', () => {
    const result = buildGeneratorMatrix(G_741, 4);
    expect(result.n).toBe(7);
    expect(result.k).toBe(4);
    expect(result.r).toBe(3);
    expect(result.generatorAlgebraic).toBe('x^3 + x + 1');
  });

  it('builds non-systematic rows as shifts of g(x)', () => {
    const { nonSystematic } = buildGeneratorMatrix(G_741, 4);
    expect(nonSystematic.map(bitsToString)).toEqual([
      '1011000',
      '0101100',
      '0010110',
      '0001011',
    ]);
  });

  it('builds systematic G as [I_k | P]', () => {
    const { systematic, k } = buildGeneratorMatrix(G_741, 4);
    // Left half must be the identity.
    systematic.forEach((row, i) => {
      row.slice(0, k).forEach((b, j) => expect(b).toBe(i === j ? 1 : 0));
    });
    expect(systematic.map(bitsToString)).toEqual([
      '1000101',
      '0100111',
      '0010110',
      '0001011',
    ]);
  });

  it('builds H as [Pᵀ | I_r] and satisfies G·Hᵀ = 0', () => {
    const result = buildGeneratorMatrix(G_741, 4);
    expect(result.parityCheck).toHaveLength(3);
    expect(result.parityCheck[0]).toHaveLength(7);
    expect(result.valid).toBe(true);
    expect(isZeroMatrix(result.product)).toBe(true);
  });

  it('satisfies G·Hᵀ = 0 across many generators and message lengths', () => {
    const polys = ['x^3 + x + 1', 'x^4 + x + 1', 'x^5 + x^2 + 1', 'x^8 + x^2 + x + 1', 'x^16 + x^12 + x^5 + 1'];
    for (const p of polys) {
      const g = parsePolynomial(p).bits;
      for (const k of [1, 2, 4, 7, 11]) {
        const result = buildGeneratorMatrix(g, k);
        expect(result.valid, `${p} k=${k}`).toBe(true);
        expect(result.systematic).toHaveLength(k);
        expect(result.systematic[0]).toHaveLength(result.n);
        expect(result.parityCheck).toHaveLength(result.r);
      }
    }
  });

  it('records a division derivation for every systematic row', () => {
    const { systematicSteps, k, r, n } = buildGeneratorMatrix(G_741, 4);
    expect(systematicSteps).toHaveLength(k);
    systematicSteps.forEach((step, i) => {
      expect(step.exponent).toBe(n - 1 - i);
      expect(step.remainder).toHaveLength(r);
      expect(step.division.steps.length).toBeGreaterThan(0);
      expect(step.note).toContain(`x^${n - 1 - i}`);
    });
  });

  it('rejects invalid parameters', () => {
    expect(() => buildGeneratorMatrix([0, 0], 4)).toThrow(/cannot be zero/);
    expect(() => buildGeneratorMatrix([1, 1], 0)).toThrow(/positive integer/);
    expect(() => buildGeneratorMatrix([1], 4)).toThrow(/degree >= 1/);
  });
});

describe('encoding agrees with CRC', () => {
  it('m·G with systematic G equals message + FCS', () => {
    const polys = ['x^3 + x + 1', 'x^4 + x + 1', 'x^8 + x^2 + x + 1'];
    for (const p of polys) {
      const g = parsePolynomial(p).bits;
      for (const k of [4, 8, 11]) {
        const { systematic } = buildGeneratorMatrix(g, k);
        for (let trial = 0; trial < 20; trial++) {
          const message = Array.from({ length: k }, () => (Math.random() < 0.5 ? 1 : 0)) as Bits;
          const viaMatrix = bitsToString(encode(message, systematic));
          const viaCrc = bitsToString(crcGenerate(message, g).codeword);
          expect(viaMatrix, `${p} k=${k}`).toBe(viaCrc);
        }
      }
    }
  });

  it('non-systematic encoding produces valid codewords too', () => {
    const g = parsePolynomial('x^3 + x + 1').bits;
    const { nonSystematic, parityCheck } = buildGeneratorMatrix(g, 4);
    const message = stringToBits('1011');
    const codeword = encode(message, nonSystematic);
    expect(syndrome(codeword, parityCheck).every((b) => b === 0)).toBe(true);
  });
});

describe('encodeSteps', () => {
  it('records one step per message bit and lands on the same codeword as encode()', () => {
    const { systematic } = buildGeneratorMatrix(G_741, 4);
    const message = stringToBits('1011');
    const trace = encodeSteps(message, systematic);
    expect(trace.steps).toHaveLength(4);
    expect(trace.codeword).toEqual(encode(message, systematic));
  });

  it('selects exactly the rows whose message bit is 1', () => {
    const { systematic } = buildGeneratorMatrix(G_741, 4);
    const trace = encodeSteps(stringToBits('1011'), systematic);
    expect(trace.selectedRows).toEqual([0, 2, 3]);
    expect(trace.steps.filter((s) => s.used).map((s) => s.row)).toEqual([0, 2, 3]);
  });

  it('leaves the accumulator untouched on a zero bit', () => {
    const { systematic } = buildGeneratorMatrix(G_741, 4);
    for (const step of encodeSteps(stringToBits('1011'), systematic).steps) {
      if (step.messageBit === 0) expect(step.after).toEqual(step.before);
      else expect(step.after).toEqual(step.before.map((b, j) => b ^ step.rowBits[j]));
    }
  });

  it('agrees with long division for random messages across presets', () => {
    for (const p of ['x^3 + x + 1', 'x^4 + x + 1', 'x^8 + x^2 + x + 1', 'x^16 + x^12 + x^5 + 1']) {
      const g = parsePolynomial(p).bits;
      for (const k of [4, 9, 16]) {
        const { systematic } = buildGeneratorMatrix(g, k);
        for (let trial = 0; trial < 10; trial++) {
          const message = Array.from({ length: k }, () => (Math.random() < 0.5 ? 1 : 0)) as Bits;
          const viaMatrix = encodeSteps(message, systematic).codeword;
          const viaDivision = crcGenerate(message, g).codeword;
          expect(bitsToString(viaMatrix), `${p} k=${k}`).toBe(bitsToString(viaDivision));
        }
      }
    }
  });

  it('produces an all-zero codeword for an all-zero message', () => {
    const { systematic } = buildGeneratorMatrix(G_741, 4);
    const trace = encodeSteps(stringToBits('0000'), systematic);
    expect(trace.selectedRows).toEqual([]);
    expect(trace.codeword.every((b) => b === 0)).toBe(true);
  });

  it('rejects a message of the wrong length', () => {
    const { systematic } = buildGeneratorMatrix(G_741, 4);
    expect(() => encodeSteps(stringToBits('101'), systematic)).toThrow(/but G has 4 rows/);
  });
});

describe('syndrome decoding', () => {
  it('gives a zero syndrome for every valid codeword', () => {
    const { systematic, parityCheck, k } = buildGeneratorMatrix(G_741, 4);
    for (let m = 0; m < 1 << k; m++) {
      const message = Array.from({ length: k }, (_, i) => ((m >> (k - 1 - i)) & 1) as 0 | 1);
      const codeword = encode(message, systematic);
      expect(syndrome(codeword, parityCheck).every((b) => b === 0), `m=${m}`).toBe(true);
    }
  });

  it('rejects a codeword of the wrong length', () => {
    const { parityCheck } = buildGeneratorMatrix(G_741, 4);
    expect(() => syndrome(stringToBits('101'), parityCheck)).toThrow(/but H has/);
  });
});

describe('minimum distance', () => {
  it('finds d = 3 for the (7,4) Hamming-equivalent cyclic code', () => {
    const { systematic } = buildGeneratorMatrix(G_741, 4);
    expect(minimumDistance(systematic)).toBe(3);
  });

  it('is unchanged by the choice of basis', () => {
    const { systematic, nonSystematic } = buildGeneratorMatrix(G_741, 4);
    expect(minimumDistance(nonSystematic)).toBe(minimumDistance(systematic));
  });

  it('guards against exponential blow-up', () => {
    const { systematic } = buildGeneratorMatrix(G_741, 20);
    expect(() => minimumDistance(systematic)).toThrow(/limited to k/);
  });
});
