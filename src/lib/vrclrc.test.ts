import { describe, it, expect } from 'vitest';
import {
  buildParityBlock,
  bytesToRows,
  checkParityBlock,
  flipDataBit,
  rectangularBlindSpot,
  parseBinaryRowsDetailed,
} from './vrclrc';
import { textToBytes, bitsToString } from './gf2';

function blockFor(text: string, parity: 'even' | 'odd' = 'even', bitsPerRow: 7 | 8 = 8) {
  return buildParityBlock(bytesToRows(textToBytes(text), bitsPerRow), { parity, bitsPerRow });
}

describe('buildParityBlock', () => {
  it('computes even row parity', () => {
    // 'A' = 0x41 = 01000001, two ones -> even parity bit 0
    const block = blockFor('A');
    expect(bitsToString(block.rows[0])).toBe('01000001');
    expect(block.vrc[0]).toBe(0);
  });

  it('computes odd row parity as the complement', () => {
    expect(blockFor('A', 'odd').vrc[0]).toBe(1);
  });

  it('computes the LRC as a column-wise XOR', () => {
    const block = blockFor('AB');
    // 'A' 01000001, 'B' 01000010 -> column XOR 00000011
    expect(bitsToString(block.lrc)).toBe('00000011');
  });

  it('supports 7-bit ASCII framing', () => {
    const block = blockFor('A', 'even', 7);
    expect(block.rows[0].length).toBe(7);
    expect(bitsToString(block.rows[0])).toBe('1000001');
  });

  it('rejects rows of the wrong width', () => {
    expect(() => buildParityBlock([[1, 0, 1]], { bitsPerRow: 8 })).toThrow(/8 bits/);
  });

  it('rejects an empty block', () => {
    expect(() => buildParityBlock([])).toThrow(/at least one/);
  });
});

describe('parseBinaryRows', () => {
  it('reads one row per line', () => {
    const rows = parseBinaryRowsDetailed('11100111\n11011101\n00111001\n10101001').rows;
    expect(rows).toHaveLength(4);
    expect(rows.map(bitsToString)).toEqual(['11100111', '11011101', '00111001', '10101001']);
  });

  it('ignores spaces inside a row', () => {
    expect(bitsToString(parseBinaryRowsDetailed('1110 0111').rows[0])).toBe('11100111');
  });

  it('accepts commas and semicolons as row separators', () => {
    expect(parseBinaryRowsDetailed('1010,0101;1100').rows).toHaveLength(3);
  });

  it('tolerates blank lines and trailing newlines', () => {
    expect(parseBinaryRowsDetailed('1010\n\n0101\n').rows).toHaveLength(2);
  });

  it('chunks a single continuous string when given a row width', () => {
    const rows = parseBinaryRowsDetailed('1110011111011101', 8).rows;
    expect(rows.map(bitsToString)).toEqual(['11100111', '11011101']);
  });

  it('leaves a single line intact when no width is given', () => {
    const rows = parseBinaryRowsDetailed('1110011111011101').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(16);
  });

  it('supports row widths that are not 7 or 8', () => {
    const rows = parseBinaryRowsDetailed('10101\n01010\n11111').rows;
    expect(rows.every((r) => r.length === 5)).toBe(true);
    const block = buildParityBlock(rows, { bitsPerRow: 5 });
    expect(block.lrc).toHaveLength(5);
    expect(checkParityBlock(block).ok).toBe(true);
  });

  it('reports a ragged block with the offending row number', () => {
    expect(() => parseBinaryRowsDetailed('1010\n010\n1100').rows).toThrow(/widest is 4 bits but row 2 is 3/);
  });

  it('reports a chunk width that does not divide evenly', () => {
    expect(() => parseBinaryRowsDetailed('101010101', 8).rows).toThrow(/1 left over/);
  });

  it('zero-pads short rows when padding is enabled', () => {
    const r = parseBinaryRowsDetailed('1010\n010\n1100', undefined, true);
    expect(r.width).toBe(4);
    expect(r.rows.map(bitsToString)).toEqual(['1010', '0100', '1100']);
    expect(r.padded).toEqual([{ row: 1, bits: 1 }]);
    expect(r.totalPadBits).toBe(1);
  });

  it('pads up to the widest row, never truncating', () => {
    const r = parseBinaryRowsDetailed('10\n101010\n1', undefined, true);
    expect(r.width).toBe(6);
    expect(r.rows.map(bitsToString)).toEqual(['100000', '101010', '100000']);
    expect(r.totalPadBits).toBe(4 + 0 + 5);
  });

  it('zero-pads a continuous string that does not divide evenly', () => {
    const r = parseBinaryRowsDetailed('101010101', 4, true);
    expect(r.rows.map(bitsToString)).toEqual(['1010', '1010', '1000']);
    expect(r.totalPadBits).toBe(3);
  });

  it('reports no padding when everything already lines up', () => {
    const r = parseBinaryRowsDetailed('1010\n0101', undefined, true);
    expect(r.padded).toEqual([]);
    expect(r.totalPadBits).toBe(0);
  });

  it('padded rows still build a valid parity block', () => {
    const r = parseBinaryRowsDetailed('1010\n010\n1100', undefined, true);
    const block = buildParityBlock(r.rows, { bitsPerRow: r.width });
    expect(checkParityBlock(block).ok).toBe(true);
  });

  it('rejects non-binary characters', () => {
    expect(() => parseBinaryRowsDetailed('1010\n12x0').rows).toThrow(/not binary/);
  });

  it('rejects empty input', () => {
    expect(() => parseBinaryRowsDetailed('   \n  ').rows).toThrow(/at least one row/);
  });

  it('feeds straight into buildParityBlock and round-trips', () => {
    // Forouzan's worked LRC example.
    const rows = parseBinaryRowsDetailed('11100111\n11011101\n00111001\n10101001').rows;
    const block = buildParityBlock(rows, { bitsPerRow: 8, parity: 'even' });
    expect(bitsToString(block.lrc)).toBe('10101010');
    expect(checkParityBlock(block).ok).toBe(true);
  });
});

describe('checkParityBlock', () => {
  it('passes an untouched block', () => {
    expect(checkParityBlock(blockFor('Network')).ok).toBe(true);
  });

  it('catches and locates any single-bit error', () => {
    const block = blockFor('Network');
    for (let r = 0; r < block.rows.length; r++) {
      for (let c = 0; c < block.bitsPerRow; c++) {
        const result = checkParityBlock(flipDataBit(block, r, c));
        expect(result.ok, `bit ${r},${c}`).toBe(false);
        // Exactly one row and one column fail, which pinpoints the bit.
        expect(result.correctable, `bit ${r},${c}`).toEqual({ row: r, column: c });
      }
    }
  });

  it('catches any two-bit error', () => {
    const block = blockFor('Longitudinal');
    for (let trial = 0; trial < 200; trial++) {
      const r1 = Math.floor(Math.random() * block.rows.length);
      const c1 = Math.floor(Math.random() * block.bitsPerRow);
      let r2 = Math.floor(Math.random() * block.rows.length);
      let c2 = Math.floor(Math.random() * block.bitsPerRow);
      if (r1 === r2 && c1 === c2) c2 = (c2 + 1) % block.bitsPerRow;
      const corrupted = flipDataBit(flipDataBit(block, r1, c1), r2, c2);
      expect(checkParityBlock(corrupted).ok, `${r1},${c1} + ${r2},${c2}`).toBe(false);
    }
  });

  it('catches any three-bit error', () => {
    const block = blockFor('Longitudinal');
    for (let trial = 0; trial < 200; trial++) {
      const picks = new Set<string>();
      while (picks.size < 3) {
        picks.add(`${Math.floor(Math.random() * block.rows.length)},${Math.floor(Math.random() * block.bitsPerRow)}`);
      }
      let corrupted = block;
      for (const p of picks) {
        const [r, c] = p.split(',').map(Number);
        corrupted = flipDataBit(corrupted, r, c);
      }
      expect(checkParityBlock(corrupted).ok, [...picks].join(' ')).toBe(false);
    }
  });

  it('is fooled by the rectangular four-bit pattern — the blind spot', () => {
    const block = blockFor('Network');
    const corrupted = rectangularBlindSpot(block, 0, 1, 0, 1);

    // Four bits really are different from the original...
    const differing = corrupted.rows.flatMap((row, r) =>
      row.filter((b, c) => b !== block.rows[r][c]),
    );
    expect(differing.length).toBe(4);

    // ...yet every parity bit still agrees.
    const result = checkParityBlock(corrupted);
    expect(result.ok).toBe(true);
    expect(result.badRows).toEqual([]);
    expect(result.badColumns).toEqual([]);
    expect(result.correctable).toBeNull();
  });

  it('is fooled by rectangles at any corner positions', () => {
    const block = blockFor('Longitudinal');
    for (const [r1, r2, c1, c2] of [
      [0, 3, 1, 6],
      [2, 5, 0, 7],
      [1, 2, 3, 4],
    ] as const) {
      expect(checkParityBlock(rectangularBlindSpot(block, r1, r2, c1, c2)).ok).toBe(true);
    }
  });

  it('refuses to build a rectangle from degenerate coordinates', () => {
    const block = blockFor('Hi');
    expect(() => rectangularBlindSpot(block, 0, 0, 1, 2)).toThrow(/distinct/);
    expect(() => rectangularBlindSpot(blockFor('X'), 0, 1, 0, 1)).toThrow(/at least 2/);
  });

  it('rejects out-of-range flips', () => {
    const block = blockFor('Hi');
    expect(() => flipDataBit(block, 9, 0)).toThrow(/Row 9/);
    expect(() => flipDataBit(block, 0, 99)).toThrow(/Column 99/);
  });
});
