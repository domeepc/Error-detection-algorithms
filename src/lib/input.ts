/**
 * Turning what a user types into bits.
 *
 * Every calculator on the site accepts the same three input modes, so the parsing and the
 * error messages live here rather than being reimplemented per component.
 */

import { type Bits, stringToBits, bytesToBits, textToBytes, bitsToBytes } from './gf2';

export type InputMode = 'text' | 'binary' | 'hex';

export const INPUT_MODES: Array<{ id: InputMode; label: string; placeholder: string }> = [
  { id: 'text', label: 'Text', placeholder: 'Hello' },
  { id: 'binary', label: 'Binary', placeholder: '1101011011' },
  { id: 'hex', label: 'Hex', placeholder: '48 65 6C 6C 6F' },
];

export interface ParsedInput {
  bits: Bits;
  bytes: number[] | null;
  mode: InputMode;
}

function parseInput(value: string, mode: InputMode): ParsedInput {
  const raw = value.trim();
  if (!raw) throw new Error('Enter some data first');

  switch (mode) {
    case 'text': {
      const bytes = textToBytes(raw);
      return { bits: bytesToBits(bytes), bytes, mode };
    }
    case 'binary': {
      const cleaned = raw.replace(/[\s_]/g, '');
      if (!/^[01]+$/.test(cleaned)) {
        throw new Error('Binary input may only contain 0 and 1');
      }
      const bits = stringToBits(cleaned);
      // Bytes are only meaningful on a byte boundary; the checksum page needs that.
      return { bits, bytes: bits.length % 8 === 0 ? bitsToBytes(bits) : null, mode };
    }
    case 'hex': {
      const cleaned = raw.replace(/^0x/i, '').replace(/[\s_,]/g, '');
      if (!/^[0-9a-f]+$/i.test(cleaned)) {
        throw new Error('Hex input may only contain 0-9 and A-F');
      }
      if (cleaned.length % 2 !== 0) {
        throw new Error(`Hex input needs an even number of digits (got ${cleaned.length})`);
      }
      const bytes = (cleaned.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16));
      return { bits: bytesToBits(bytes), bytes, mode };
    }
  }
}

/** Best-effort parse that returns an error string rather than throwing — convenient for reactive UI. */
export function tryParseInput(
  value: string,
  mode: InputMode,
): { ok: true; data: ParsedInput } | { ok: false; error: string } {
  try {
    return { ok: true, data: parseInput(value, mode) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Printable rendering of a byte, with a placeholder for control characters. */
export function byteToChar(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '·';
}
