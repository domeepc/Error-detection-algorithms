/**
 * VRC (Vertical Redundancy Check) and LRC (Longitudinal Redundancy Check).
 *
 * Despite the names, the usual textbook picture is a 2D grid: characters are rows,
 * bit positions are columns.
 *   VRC = one parity bit per character (per row)  — appended as an extra column
 *   LRC = XOR of all characters (per column)      — appended as an extra row
 *
 * The interesting part is the blind spot. Row parity catches any odd number of errors in
 * a row; column parity catches any odd number in a column. Flip four bits at the corners
 * of a rectangle and every affected row and column gains exactly two errors — parity is
 * preserved everywhere and the block passes clean. `rectangularBlindSpot` constructs
 * exactly that case for the demo.
 */

import { weight, type Bit, type Bits } from './gf2';

export type Parity = 'even' | 'odd';

export interface ParityOptions {
  parity?: Parity;
  /**
   * Bits in each data unit. 7 for classic ASCII framing, 8 for raw bytes, or any width
   * when rows are entered as binary directly — textbook exercises are not always bytes.
   */
  bitsPerRow?: number;
}

export interface ParityBlock {
  /** One row per data unit; each row is `bitsPerRow` data bits (no parity bit). */
  rows: Bits[];
  /** VRC bit for each row, same length as `rows`. */
  vrc: Bit[];
  /** LRC row: column-wise parity across all data rows. */
  lrc: Bits;
  /** Parity of the LRC row itself — the bottom-right corner of the grid. */
  corner: Bit;
  parity: Parity;
  bitsPerRow: number;
}

function parityBit(bits: readonly Bit[], parity: Parity): Bit {
  const ones = weight(bits);
  const even = ones % 2 === 0;
  // Even parity: bit makes the total count even. Odd parity: makes it odd.
  return (parity === 'even' ? (even ? 0 : 1) : even ? 1 : 0) as Bit;
}

export function bytesToRows(bytes: number[], bitsPerRow: number): Bits[] {
  return bytes.map((byte) => {
    const row: Bits = [];
    for (let i = bitsPerRow - 1; i >= 0; i--) row.push(((byte >> i) & 1) as Bit);
    return row;
  });
}

/**
 * Parse binary rows typed by hand — one data unit per line.
 *
 * Accepts a line-per-row block:
 *     11100111
 *     11011101
 * or a single continuous string, which is chunked into `chunkWidth`-bit rows. Rows may
 * be separated by newlines, commas or semicolons, and spaces inside a row are ignored
 * so `1110 0111` works.
 */
export interface ParseRowsResult {
  rows: Bits[];
  /** Width every row was normalised to. */
  width: number;
  /** Zero bits appended, per row index, for rows that were short. */
  padded: Array<{ row: number; bits: number }>;
  totalPadBits: number;
}

/**
 * Parse binary rows, optionally zero-padding short ones.
 *
 * With `pad` off a ragged block is an error, which is what you want when transcribing an
 * exercise — a mistyped row should be caught, not silently "fixed". With `pad` on, short
 * rows are filled with zeros on the right so any input produces a rectangular grid.
 */
export function parseBinaryRowsDetailed(
  input: string,
  chunkWidth?: number,
  pad = false,
): ParseRowsResult {
  const lines = input
    .split(/[\n\r;,]+/)
    .map((l) => l.replace(/[\s_]/g, ''))
    .filter(Boolean);

  if (lines.length === 0) throw new Error('Enter at least one row of bits');

  for (const line of lines) {
    if (!/^[01]+$/.test(line)) {
      throw new Error(`"${line}" is not binary — rows may only contain 0 and 1`);
    }
  }

  const padded: Array<{ row: number; bits: number }> = [];

  // A single long string is ambiguous on its own, so it is only split when the caller
  // supplies a row width.
  if (lines.length === 1 && chunkWidth) {
    const s = lines[0];
    const leftover = s.length % chunkWidth;
    if (leftover !== 0) {
      if (!pad) {
        throw new Error(
          `${s.length} bits does not divide into ${chunkWidth}-bit rows ` +
            `(${leftover} left over). Adjust the row width, turn on padding, or put one row per line.`,
        );
      }
      const fill = chunkWidth - leftover;
      padded.push({ row: Math.floor(s.length / chunkWidth), bits: fill });
      const filled = s + '0'.repeat(fill);
      return {
        rows: (filled.match(new RegExp(`.{${chunkWidth}}`, 'g')) ?? []).map(toBits),
        width: chunkWidth,
        padded,
        totalPadBits: fill,
      };
    }
    return {
      rows: (s.match(new RegExp(`.{${chunkWidth}}`, 'g')) ?? []).map(toBits),
      width: chunkWidth,
      padded,
      totalPadBits: 0,
    };
  }

  // Pad up to the widest row, so no data is ever truncated.
  const width = Math.max(...lines.map((l) => l.length));
  if (!pad) {
    const odd = lines.findIndex((l) => l.length !== width);
    if (odd !== -1) {
      throw new Error(
        `Every row must be the same width: the widest is ${width} bits but row ${odd + 1} is ` +
          `${lines[odd].length}. Turn on padding to zero-fill short rows.`,
      );
    }
    return { rows: lines.map(toBits), width, padded, totalPadBits: 0 };
  }

  const rows = lines.map((l, i) => {
    if (l.length < width) padded.push({ row: i, bits: width - l.length });
    return toBits(l.padEnd(width, '0'));
  });

  return {
    rows,
    width,
    padded,
    totalPadBits: padded.reduce((n, p) => n + p.bits, 0),
  };
}

function toBits(s: string): Bits {
  return [...s].map((c) => (c === '1' ? 1 : 0) as Bit);
}

/** Build the full 2D parity block from data-unit rows. */
export function buildParityBlock(rows: Bits[], opts: ParityOptions = {}): ParityBlock {
  const parity = opts.parity ?? 'even';
  const bitsPerRow = opts.bitsPerRow ?? 8;
  if (rows.length === 0) throw new Error('Parity block needs at least one character');
  for (const row of rows) {
    if (row.length !== bitsPerRow) {
      throw new Error(`Every row must be ${bitsPerRow} bits, got ${row.length}`);
    }
  }

  const vrc = rows.map((row) => parityBit(row, parity));

  const lrc: Bits = [];
  for (let col = 0; col < bitsPerRow; col++) {
    lrc.push(parityBit(rows.map((r) => r[col]), parity));
  }

  return { rows: rows.map((r) => r.slice()), vrc, lrc, corner: parityBit(lrc, parity), parity, bitsPerRow };
}

export interface ParityCheckResult {
  ok: boolean;
  /** Indices of rows whose VRC bit disagrees with the data. */
  badRows: number[];
  /** Indices of columns whose LRC bit disagrees with the data. */
  badColumns: number[];
  /**
   * True when exactly one row and one column fail, which pinpoints the flipped bit —
   * 2D parity is a single-error-correcting code, not just detecting.
   */
  correctable: { row: number; column: number } | null;
}

/**
 * Re-derive parity from the received data and compare against the received parity bits.
 */
export function checkParityBlock(received: ParityBlock): ParityCheckResult {
  const { rows, bitsPerRow, parity } = received;

  const badRows: number[] = [];
  rows.forEach((row, i) => {
    if (parityBit(row, parity) !== received.vrc[i]) badRows.push(i);
  });

  const badColumns: number[] = [];
  for (let col = 0; col < bitsPerRow; col++) {
    if (parityBit(rows.map((r) => r[col]), parity) !== received.lrc[col]) badColumns.push(col);
  }

  const badCorner = parityBit(received.lrc, parity) !== received.corner;
  const ok = badRows.length === 0 && badColumns.length === 0 && !badCorner;

  return {
    ok,
    badRows,
    badColumns,
    correctable:
      badRows.length === 1 && badColumns.length === 1
        ? { row: badRows[0], column: badColumns[0] }
        : null,
  };
}

/** Flip one bit in the data area, returning a new block (parity bits left untouched). */
export function flipDataBit(block: ParityBlock, row: number, column: number): ParityBlock {
  if (row < 0 || row >= block.rows.length) throw new Error(`Row ${row} out of range`);
  if (column < 0 || column >= block.bitsPerRow) throw new Error(`Column ${column} out of range`);
  const rows = block.rows.map((r) => r.slice());
  rows[row][column] = (rows[row][column] ^ 1) as Bit;
  return { ...block, rows, vrc: [...block.vrc], lrc: [...block.lrc] };
}

/**
 * The classic failure case: flip the four corners of a rectangle.
 *
 * Each touched row and each touched column gains exactly two flipped bits, so every
 * parity bit still agrees and the block verifies as clean despite four corrupted bits.
 * Requires at least 2 rows and 2 columns.
 */
export function rectangularBlindSpot(
  block: ParityBlock,
  r1 = 0,
  r2 = 1,
  c1 = 0,
  c2 = 1,
): ParityBlock {
  if (block.rows.length < 2) throw new Error('Need at least 2 characters to build a rectangle');
  if (r1 === r2 || c1 === c2) throw new Error('Rectangle needs two distinct rows and two distinct columns');
  let out = block;
  for (const [r, c] of [
    [r1, c1],
    [r1, c2],
    [r2, c1],
    [r2, c2],
  ] as const) {
    out = flipDataBit(out, r, c);
  }
  return out;
}
