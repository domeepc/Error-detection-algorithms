import { describe, it, expect } from 'vitest';
import { crcGenerate, crcVerify, burstGuarantees } from './crc';
import { runLfsr } from './lfsr';
import { randomBurst, randomError, applyPattern, patternFromIndices, burstSpan } from './errors';
import { parsePolynomial, stringToBits, bitsToString, type Bits, POLY_PRESETS } from './gf2';

const G4 = stringToBits('10011'); // x^4 + x + 1

function randomBits(n: number): Bits {
  return Array.from({ length: n }, () => (Math.random() < 0.5 ? 1 : 0)) as Bits;
}

describe('crcGenerate / crcVerify', () => {
  it('reproduces the Tanenbaum worked example end to end', () => {
    const result = crcGenerate(stringToBits('1101011011'), G4);
    expect(bitsToString(result.fcs)).toBe('1110');
    expect(bitsToString(result.codeword)).toBe('11010110111110');
  });

  it('verifies a clean codeword', () => {
    const { codeword } = crcGenerate(stringToBits('1101011011'), G4);
    const check = crcVerify(codeword, G4);
    expect(check.ok).toBe(true);
    expect(bitsToString(check.remainder)).toBe('0000');
    expect(bitsToString(check.message)).toBe('1101011011');
  });

  it('always produces an FCS of exactly deg(g) bits', () => {
    for (const preset of POLY_PRESETS) {
      const g = parsePolynomial(preset.algebraic).bits;
      const { fcs } = crcGenerate(stringToBits('110100111000101'), g);
      expect(fcs.length, preset.label).toBe(preset.width);
    }
  });

  it('codeword divisibility holds for random messages and every preset', () => {
    for (const preset of POLY_PRESETS) {
      const g = parsePolynomial(preset.algebraic).bits;
      for (let trial = 0; trial < 25; trial++) {
        const message = randomBits(8 + Math.floor(Math.random() * 60));
        const { codeword } = crcGenerate(message, g);
        expect(crcVerify(codeword, g).ok, `${preset.label} trial ${trial}`).toBe(true);
      }
    }
  });

  it('detects every single-bit error', () => {
    const g = parsePolynomial('x^8 + x^2 + x + 1').bits;
    const { codeword } = crcGenerate(randomBits(40), g);
    for (let i = 0; i < codeword.length; i++) {
      const corrupted = applyPattern(codeword, patternFromIndices(codeword.length, [i]));
      expect(crcVerify(corrupted, g).ok, `bit ${i}`).toBe(false);
    }
  });

  it('detects every burst of length <= r', () => {
    for (const preset of POLY_PRESETS.filter((p) => p.width <= 16)) {
      const g = parsePolynomial(preset.algebraic).bits;
      const { codeword } = crcGenerate(randomBits(64), g);
      for (let len = 1; len <= preset.width; len++) {
        for (let trial = 0; trial < 20; trial++) {
          const pattern = randomBurst(codeword.length, len);
          // A burst's measured span can be shorter only if the generator produced
          // clear ends, which burstError prevents; assert the invariant holds.
          expect(burstSpan(pattern)).toBe(len);
          const corrupted = applyPattern(codeword, pattern);
          expect(crcVerify(corrupted, g).ok, `${preset.label} burst len ${len}`).toBe(false);
        }
      }
    }
  });

  it('detects all odd-weight errors when g(x) has (x + 1) as a factor', () => {
    // x^16 + x^15 + x^2 + 1 = (x + 1)(x^15 + x + 1), so it catches any odd number of flips.
    const g = parsePolynomial('x^16 + x^15 + x^2 + 1').bits;
    const { codeword } = crcGenerate(randomBits(48), g);
    for (const oddWeight of [1, 3, 5, 7, 9]) {
      for (let trial = 0; trial < 30; trial++) {
        const corrupted = applyPattern(codeword, randomError(codeword.length, oddWeight));
        expect(crcVerify(corrupted, g).ok, `weight ${oddWeight}`).toBe(false);
      }
    }
  });

  it('rejects a codeword shorter than the FCS', () => {
    expect(() => crcVerify(stringToBits('101'), G4)).toThrow(/shorter than/);
  });

  it('states burst guarantees for a given width', () => {
    const g = burstGuarantees(16);
    expect(g.alwaysDetected).toBe(16);
    expect(g.escapeAtRPlus1).toBeCloseTo(Math.pow(2, -15));
    expect(g.escapeBeyond).toBeCloseTo(Math.pow(2, -16));
  });
});

describe('LFSR agrees with long division', () => {
  it('systematic architecture yields the same CRC, for every preset', () => {
    for (const preset of POLY_PRESETS) {
      const g = parsePolynomial(preset.algebraic).bits;
      for (let trial = 0; trial < 15; trial++) {
        const message = randomBits(16 + Math.floor(Math.random() * 48));
        const expected = bitsToString(crcGenerate(message, g).fcs);
        expect(bitsToString(runLfsr(message, g, 'systematic').register), `${preset.label} trial ${trial}`).toBe(expected);
      }
    }
  });

  it('external architecture yields the same CRC once flushed with r zeros', () => {
    for (const preset of POLY_PRESETS) {
      const g = parsePolynomial(preset.algebraic).bits;
      for (let trial = 0; trial < 15; trial++) {
        const message = randomBits(16 + Math.floor(Math.random() * 48));
        const expected = bitsToString(crcGenerate(message, g).fcs);
        expect(bitsToString(runLfsr(message, g, 'external').register), `${preset.label} trial ${trial}`).toBe(expected);
      }
    }
  });

  it('systematic form finishes r clocks sooner than external', () => {
    const message = stringToBits('1101011011');
    const sys = runLfsr(message, G4, 'systematic');
    const ext = runLfsr(message, G4, 'external');
    expect(sys.clocks.length).toBe(message.length);
    expect(ext.clocks.length).toBe(message.length + 4);
  });

  it('register contents track the long-division working remainder', () => {
    // Both machines compute the same residue, but they are offset in time. After
    // division step i the window work[i+1 .. i+r] is the residue of the first i+r+1
    // dividend bits; the LFSR reaches that same residue only once it has clocked in
    // all i+r+1 of them. So step i lines up with clock i+r+1 (array index i+r).
    const r = 4;
    const message = stringToBits('11010110110101');
    const { clocks } = runLfsr(message, G4, 'external');
    const { division } = crcGenerate(message, G4);

    let compared = 0;
    division.steps.forEach((step, i) => {
      const clock = clocks[i + r];
      if (!clock) return;
      const window = step.after.slice(i + 1, i + 1 + r);
      expect(bitsToString(clock.after), `step ${i} vs clock ${clock.clock}`).toBe(
        bitsToString(window as Bits),
      );
      compared++;
    });

    expect(compared).toBeGreaterThan(5);
    // The alignment must hold all the way to the end: last step == final CRC.
    expect(bitsToString(clocks[clocks.length - 1].after)).toBe(bitsToString(division.remainder));
  });

  it('has exactly deg(g) stages', () => {
    for (const preset of POLY_PRESETS) {
      const g = parsePolynomial(preset.algebraic).bits;
      expect(runLfsr(stringToBits('10110'), g).stages, preset.label).toBe(preset.width);
    }
  });
});
