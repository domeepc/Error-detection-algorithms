/**
 * GF(2) polynomial arithmetic — the shared core of the whole error-detection chapter.
 *
 * Every visual on the site (long-division table, LFSR register trace, generator-matrix
 * rows, frame verification) is a rendering of the same `polyDivideSteps` trace, so this
 * module returns intermediate state rather than just answers.
 *
 * Convention: a polynomial is a MSB-first bit array including its leading 1, so
 * `[1,0,1,1]` is x³ + x + 1 and its degree is `length - 1`.
 */

export type Bit = 0 | 1;
export type Bits = Bit[];

/* ------------------------------------------------------------------ *
 * Bit helpers
 * ------------------------------------------------------------------ */

export function bitsToString(bits: Bits): string {
  return bits.join('');
}

export function stringToBits(s: string): Bits {
  const cleaned = s.replace(/[\s_]/g, '');
  if (!/^[01]+$/.test(cleaned)) {
    throw new Error(`Not a binary string: "${s}"`);
  }
  return [...cleaned].map((c) => (c === '1' ? 1 : 0));
}

/** Drop leading zeros so the array starts at the true highest set term. */
export function normalize(bits: Bits): Bits {
  const first = bits.indexOf(1);
  return first === -1 ? [0] : bits.slice(first);
}

export function degree(bits: Bits): number {
  const n = normalize(bits);
  return n.length === 1 && n[0] === 0 ? -Infinity : n.length - 1;
}

/** Number of set bits — Hamming weight, popcount. */
export function weight(bits: readonly Bit[]): number {
  return bits.reduce<number>((n, b) => n + b, 0);
}

export function isZero(bits: Bits): boolean {
  return bits.every((b) => b === 0);
}

/** Left-pad with zeros to an exact width (used to line up matrix rows). */
export function padLeft(bits: Bits, width: number): Bits {
  if (bits.length >= width) return bits.slice(bits.length - width);
  return [...(Array(width - bits.length).fill(0) as Bits), ...bits];
}

export function padRight(bits: Bits, width: number): Bits {
  if (bits.length >= width) return bits.slice(0, width);
  return [...bits, ...(Array(width - bits.length).fill(0) as Bits)];
}

/** Split a bit array into fixed-width chunks; a short tail is kept as-is. */
export function chunk(bits: Bits, width: number): Bits[] {
  const out: Bits[] = [];
  for (let i = 0; i < bits.length; i += width) out.push(bits.slice(i, i + width));
  return out;
}

/** Exponents with a set coefficient, descending — the terms of the polynomial. */
export function terms(bits: Bits): number[] {
  const top = bits.length - 1;
  return bits.flatMap((b, i) => (b ? [top - i] : []));
}

/* ------------------------------------------------------------------ *
 * Text / byte conversion
 * ------------------------------------------------------------------ */

export function bytesToBits(bytes: number[] | Uint8Array): Bits {
  return [...bytes].flatMap((byte) => stringToBits(byte.toString(2).padStart(8, '0')));
}

export function bitsToBytes(bits: Bits): number[] {
  const padded = bits.length % 8 === 0 ? bits : padRight(bits, Math.ceil(bits.length / 8) * 8);
  return chunk(padded, 8).map((byte) => parseInt(byte.join(''), 2));
}

export function textToBytes(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

/* ------------------------------------------------------------------ *
 * Polynomial parsing / formatting
 * ------------------------------------------------------------------ */

export type PolyNotation = 'algebraic' | 'hex' | 'binary';

export interface ParsedPolynomial {
  bits: Bits;
  degree: number;
  notation: PolyNotation;
  /** Exponents with a set coefficient, descending. */
  terms: number[];
}

export interface ParseOptions {
  /**
   * CRC width in bits. Hex polynomial constants conventionally omit the implied x^width
   * term (`0x1021` means CRC-16-CCITT, not x^12 + x^5 + 1), but that term is only
   * recoverable if you know the width — the hex value alone does not carry it. Supply
   * this to restore the implicit top bit; omit it and hex is read literally.
   */
  hexWidth?: number;
}

/**
 * Accepts three notations and normalises to a canonical MSB-first bit array:
 *   algebraic  "x^16 + x^12 + x^5 + 1"    unambiguous
 *   hex        "0x11021" explicit top bit, or "0x1021" with `hexWidth: 16`
 *   binary     "10001000000100001"        unambiguous
 *
 * Hex without `hexWidth` is read literally, so `0x1021` yields degree 12. That is a
 * deliberate choice: silently guessing the width produces a polynomial the user did not
 * ask for, whereas a literal read is at least predictable and visibly wrong. The UI
 * always passes the width from its width field, and the presets carry algebraic strings.
 */
export function parsePolynomial(input: string, opts: ParseOptions = {}): ParsedPolynomial {
  const raw = input.trim();
  if (!raw) throw new Error('Empty polynomial');

  let bits: Bits;
  let notation: PolyNotation;

  if (/^0x/i.test(raw)) {
    notation = 'hex';
    const hex = raw.slice(2).replace(/[\s_]/g, '');
    if (!/^[0-9a-f]+$/i.test(hex)) throw new Error(`Not a hex value: "${raw}"`);
    let value = normalize([...hex].flatMap(hexDigitToBits) as Bits);
    const { hexWidth } = opts;
    if (hexWidth !== undefined) {
      if (!Number.isInteger(hexWidth) || hexWidth < 1) {
        throw new Error(`hexWidth must be a positive integer, got ${hexWidth}`);
      }
      const significant = isZero(value) ? 0 : value.length;
      if (significant > hexWidth) {
        throw new Error(
          `Hex value ${raw} needs ${significant} bits, which does not fit in a width-${hexWidth} polynomial. ` +
            `Drop the width, or remove the explicit top bit.`,
        );
      }
      value = [1, ...padLeft(value, hexWidth)];
    }
    bits = value;
  } else if (/^[01\s_]+$/.test(raw)) {
    notation = 'binary';
    bits = normalize(stringToBits(raw));
  } else {
    notation = 'algebraic';
    bits = normalize(parseAlgebraic(raw));
  }

  bits = normalize(bits);
  if (isZero(bits)) throw new Error('Generator polynomial cannot be zero');

  return {
    bits,
    degree: bits.length - 1,
    notation,
    terms: terms(bits),
  };
}

function hexDigitToBits(c: string): Bits {
  const v = parseInt(c, 16);
  return [((v >> 3) & 1) as Bit, ((v >> 2) & 1) as Bit, ((v >> 1) & 1) as Bit, (v & 1) as Bit];
}

function parseAlgebraic(input: string): Bits {
  // Tolerate x², x^2, X2, and unicode minus/plus spacing.
  const normalized = input
    .replace(/[−–—]/g, '+')
    .replace(/[⁰¹²³⁴-⁹]/g, (m) => '^' + '0123456789'['⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(m)])
    .toLowerCase();

  const exponents = new Set<number>();
  for (const rawTerm of normalized.split('+')) {
    const term = rawTerm.trim();
    if (!term) continue;
    if (term === '1') {
      toggle(exponents, 0);
    } else if (/^x$/.test(term)) {
      toggle(exponents, 1);
    } else {
      const m = term.match(/^x\s*\^?\s*(\d+)$/);
      if (!m) throw new Error(`Cannot parse term "${rawTerm.trim()}" in "${input}"`);
      toggle(exponents, Number(m[1]));
    }
  }
  if (exponents.size === 0) throw new Error(`No terms found in "${input}"`);

  const top = Math.max(...exponents);
  const bits: Bits = Array(top + 1).fill(0) as Bits;
  for (const e of exponents) bits[top - e] = 1;
  return bits;
}

/** Repeated terms cancel over GF(2), e.g. "x + x" is 0. */
function toggle(set: Set<number>, value: number): void {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

/**
 * `x^16 + x^12 + x^5 + 1`, or with `sup` the same terms in unicode superscripts
 * (`x¹⁶ + …`) for contexts with no `<sup>`, such as SVG text or an `aria-label`.
 * The caret form is the canonical one — `parsePolynomial` round-trips through it.
 */
export function formatAlgebraic(bits: Bits, sup = false): string {
  const n = normalize(bits);
  if (isZero(n)) return '0';
  return terms(n)
    .map((exp) => (exp === 0 ? '1' : exp === 1 ? 'x' : sup ? `x${superscript(exp)}` : `x^${exp}`))
    .join(' + ');
}

export function formatHex(bits: Bits): string {
  const n = normalize(bits);
  const width = Math.ceil(n.length / 4) * 4;
  const padded = padLeft(n, width);
  let out = '';
  for (let i = 0; i < padded.length; i += 4) {
    out += ((padded[i] << 3) | (padded[i + 1] << 2) | (padded[i + 2] << 1) | padded[i + 3]).toString(16);
  }
  return '0x' + out.toUpperCase();
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** A non-negative integer rendered in unicode superscript digits, e.g. 16 -> "¹⁶". */
export function superscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUPERSCRIPT_DIGITS[Number(d)])
    .join('');
}

/* ------------------------------------------------------------------ *
 * Long division — the trace everything else renders
 * ------------------------------------------------------------------ */

export interface DivisionStep {
  /** Index into the working register where the generator was aligned. */
  index: number;
  /** Quotient bit produced at this position. */
  quotientBit: Bit;
  /** Working register before this step. */
  before: Bits;
  /** Working register after XOR (identical to `before` when quotientBit is 0). */
  after: Bits;
  /** The generator, zero-padded to the working width at its alignment. Null when skipped. */
  subtrahend: Bits | null;
}

export interface DivisionResult {
  steps: DivisionStep[];
  quotient: Bits;
  remainder: Bits;
  /** Width of the remainder = deg(generator). */
  remainderWidth: number;
}

/**
 * XOR long division of `dividend` by `generator`, recording every alignment.
 *
 * The remainder is always exactly deg(generator) bits wide (zero-padded on the left),
 * which is what CRC needs: an r-bit FCS regardless of how the division came out.
 */
export function polyDivideSteps(dividend: Bits, generator: Bits): DivisionResult {
  const gen = normalize(generator);
  if (isZero(gen)) throw new Error('Cannot divide by the zero polynomial');
  const r = gen.length - 1;

  const work = dividend.slice();
  const steps: DivisionStep[] = [];
  const quotient: Bits = [];

  // Only positions where the generator still fits inside the register produce a
  // quotient bit; what is left over below that point is the remainder.
  const lastStart = work.length - gen.length;
  for (let i = 0; i <= lastStart; i++) {
    const q = work[i];
    quotient.push(q);
    const before = work.slice();

    if (q === 1) {
      const subtrahend: Bits = Array(work.length).fill(0) as Bits;
      for (let j = 0; j < gen.length; j++) {
        subtrahend[i + j] = gen[j];
        work[i + j] = (work[i + j] ^ gen[j]) as Bit;
      }
      steps.push({ index: i, quotientBit: 1, before, after: work.slice(), subtrahend });
    } else {
      steps.push({ index: i, quotientBit: 0, before, after: work.slice(), subtrahend: null });
    }
  }

  const tail = work.slice(Math.max(0, work.length - r));
  return {
    steps,
    quotient: quotient.length ? quotient : [0],
    remainder: padLeft(tail, r),
    remainderWidth: r,
  };
}

/** Multiply two GF(2) polynomials — used to build non-systematic generator rows. */
export function polyMul(a: Bits, b: Bits): Bits {
  const na = normalize(a);
  const nb = normalize(b);
  if (isZero(na) || isZero(nb)) return [0];
  const out: Bits = Array(na.length + nb.length - 1).fill(0) as Bits;
  for (let i = 0; i < na.length; i++) {
    if (!na[i]) continue;
    for (let j = 0; j < nb.length; j++) {
      out[i + j] = (out[i + j] ^ nb[j]) as Bit;
    }
  }
  return out;
}

/** x^n as a bit array. */
export function xPow(n: number): Bits {
  return [1, ...(Array(n).fill(0) as Bits)];
}

/* ------------------------------------------------------------------ *
 * Standard generator polynomials (textbook / unreflected form)
 * ------------------------------------------------------------------ */

export interface PolyPreset {
  id: string;
  label: string;
  algebraic: string;
  hex: string;
  /** deg(g) — the width of the resulting FCS. */
  width: number;
  note: string;
}

export const POLY_PRESETS: PolyPreset[] = [
  {
    id: 'crc3-gsm',
    label: 'CRC-3/GSM',
    algebraic: 'x^3 + x + 1',
    hex: '0x3',
    width: 3,
    note: 'Tiny — best for hand-checking the division table and the circuit.',
  },
  {
    id: 'crc4-itu',
    label: 'CRC-4/ITU',
    algebraic: 'x^4 + x + 1',
    hex: '0x3',
    width: 4,
    note: 'Used in G.704 framing. Still small enough to follow by hand.',
  },
  {
    id: 'crc8',
    label: 'CRC-8 (ATM HEC)',
    algebraic: 'x^8 + x^2 + x + 1',
    hex: '0x07',
    width: 8,
    note: 'Header error control in ATM cells.',
  },
  {
    id: 'crc16-ibm',
    label: 'CRC-16/IBM (ARC)',
    algebraic: 'x^16 + x^15 + x^2 + 1',
    hex: '0x8005',
    width: 16,
    note: 'Modbus, USB, and many industrial protocols.',
  },
  {
    id: 'crc16-ccitt',
    label: 'CRC-16/CCITT',
    algebraic: 'x^16 + x^12 + x^5 + 1',
    hex: '0x1021',
    width: 16,
    note: 'HDLC, X.25, Bluetooth. The classic teaching polynomial.',
  },
  {
    id: 'crc32',
    label: 'CRC-32 (Ethernet)',
    algebraic: 'x^32 + x^26 + x^23 + x^22 + x^16 + x^12 + x^11 + x^10 + x^8 + x^7 + x^5 + x^4 + x^2 + x + 1',
    hex: '0x04C11DB7',
    width: 32,
    note: 'Ethernet, PNG, ZIP. Wide and sparse — good stress test for the circuit layout.',
  },
];
