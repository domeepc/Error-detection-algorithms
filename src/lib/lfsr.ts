/**
 * LFSR simulation for CRC — the hardware view of the same division.
 *
 * Two standard architectures:
 *
 *   'external'  (Galois / external-XOR, "divide by g(x)")
 *               Message bits shift in at the left. The bit leaving the last stage is the
 *               current quotient bit; when it is 1 the generator's taps are XORed back in.
 *               After clocking in the message *plus r zeros*, the register holds the CRC.
 *
 *   'systematic' (premultiplied)
 *               The message is XORed in at the *right* end, after the last stage, so the
 *               register is effectively fed m(x)·x^r. After exactly k clocks — no trailing
 *               zeros needed — the register holds the CRC. This is what real CRC hardware
 *               does, and why it finishes r cycles sooner.
 *
 * The key teaching point: the register contents after clock i are exactly the working
 * remainder in row i of the long-division table.
 */

import type { Bit, Bits } from './gf2';
import { normalize, isZero } from './gf2';

export type LfsrArchitecture = 'external' | 'systematic';

export interface LfsrClock {
  /** 1-based clock number. */
  clock: number;
  /** The input bit consumed on this clock, or null while flushing trailing zeros. */
  input: Bit | null;
  /** Register contents before the clock, stage 0 first. */
  before: Bits;
  /** Register contents after the clock. */
  after: Bits;
  /** The feedback bit — 1 means the tap XORs fired this cycle. */
  feedback: Bit;
  /** Bit shifted out of the register (the quotient bit). */
  output: Bit;
  /** True when this clock is flushing an appended zero rather than message data. */
  flushing: boolean;
}

export interface LfsrResult {
  architecture: LfsrArchitecture;
  generator: Bits;
  /** r = deg(g) = number of flip-flops. */
  stages: number;
  message: Bits;
  clocks: LfsrClock[];
  /** Final register contents — the CRC. */
  register: Bits;
  /** Quotient bits shifted out, in order. */
  output: Bits;
}

/**
 * Run the register and record every clock.
 *
 * Register indexing: `reg[0]` is the leftmost stage (D0), `reg[r-1]` the rightmost.
 * On each clock the whole register shifts left by one; the vacated rightmost slot takes
 * the incoming bit combined with feedback, and taps are applied where g has a coefficient.
 */
export function runLfsr(
  message: Bits,
  generator: Bits,
  architecture: LfsrArchitecture = 'systematic',
): LfsrResult {
  const g = normalize(generator);
  if (isZero(g)) throw new Error('Generator polynomial cannot be zero');
  const r = g.length - 1;
  if (r < 1) throw new Error('Generator polynomial must have degree >= 1');

  // g is [g_r, g_{r-1}, ..., g_1, g_0] MSB-first; dropping the leading term leaves exactly
  // r tap coefficients. Stage i holds the x^(r-1-i) position, so taps[i] is the coefficient
  // that feeds stage i — the indices line up directly, no offset.
  const taps: Bits = g.slice(1);

  const reg: Bits = Array(r).fill(0) as Bits;
  const clocks: LfsrClock[] = [];
  const output: Bits = [];

  // The external-XOR form must be flushed with r zeros; the systematic form does not.
  const inputs: Array<{ bit: Bit; flushing: boolean }> = message.map((b) => ({ bit: b, flushing: false }));
  if (architecture === 'external') {
    for (let i = 0; i < r; i++) inputs.push({ bit: 0, flushing: true });
  }

  inputs.forEach(({ bit, flushing }, idx) => {
    const before = reg.slice();

    // Feedback is the bit about to leave the register, combined with the input in the
    // systematic form (which is what "premultiplied" means — the message enters at the
    // high end rather than being pushed through r extra stages).
    const shiftedOut = reg[0];
    const feedback: Bit =
      architecture === 'systematic' ? ((shiftedOut ^ bit) as Bit) : (shiftedOut as Bit);

    for (let i = 0; i < r - 1; i++) {
      // Each stage takes its right neighbour, XORed with feedback where g has a tap.
      reg[i] = (reg[i + 1] ^ (taps[i] & feedback)) as Bit;
    }
    // The rightmost stage has no neighbour: it takes the incoming message bit in the
    // external form, or nothing but its tap in the systematic form (where the message
    // was already folded into `feedback`).
    const lastTap = (taps[r - 1] & feedback) as Bit;
    reg[r - 1] = (architecture === 'systematic' ? lastTap : ((bit ^ lastTap) as Bit)) as Bit;

    output.push(shiftedOut);
    clocks.push({
      clock: idx + 1,
      input: bit,
      before,
      after: reg.slice(),
      feedback,
      output: shiftedOut,
      flushing,
    });
  });

  return {
    architecture,
    generator: g,
    stages: r,
    message: message.slice(),
    clocks,
    register: reg.slice(),
    output,
  };
}
