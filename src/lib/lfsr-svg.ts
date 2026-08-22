/**
 * SVG layout for a CRC shift register, generated from an arbitrary generator polynomial.
 *
 * Geometry, derived rather than hardcoded:
 *
 *   Register indexing runs `reg[0]` = MSB, and shifting means `reg[i] = reg[i+1]`, so data
 *   moves toward index 0. To draw the conventional left-to-right flow we mirror that:
 *   visual position p holds register index r-1-p, i.e. the stage holding the x^p
 *   coefficient. Leftmost stage is x^0, rightmost is x^(r-1), and the output leaves on the
 *   right — matching every textbook diagram.
 *
 *   The wire entering visual position p carries `reg[i+1] XOR (tap · feedback)` where the
 *   tap is g's coefficient of x^p. So the rule is simply: **an XOR gate sits before stage p
 *   exactly when g has an x^p term.** Because g's constant term is always 1, the leftmost
 *   junction always has one.
 *
 * Gaps are therefore *not* uniform — a gap holding a gate is wider than a plain wire — so
 * x-positions must be accumulated, never computed as `p * pitch`.
 */

import { type Bit, type Bits, normalize, isZero, superscript } from './gf2';
import type { LfsrArchitecture } from './lfsr';

/* ------------------------------------------------------------------ *
 * Geometry constants
 * ------------------------------------------------------------------ */

const CELL_W = 52;
const CELL_H = 42;
const GAP_XOR = 56;
const GAP_PLAIN = 30;
const XOR_R = 13;
/** Row of x-power labels along the top, as in the standard textbook figure. */
const LABEL_Y = 46;
const ROW_Y = 68;
/** Feedback bus runs *below* the datapath so the top stays clear for the labels. */
const BUS_Y = 150;
const MARGIN_LEFT = 96;
const MARGIN_RIGHT = 104;
const BOTTOM_PAD = 32;

export interface StageBox {
  /** Visual position, 0 = leftmost. */
  position: number;
  /** Index into the register array from `runLfsr`. */
  regIndex: number;
  /** Power of x this stage *holds* — position p holds the x^p coefficient. */
  power: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Label drawn above the stage: x^(p+1), not x^p.
   *
   * The conventional figure marks the power of x at each *point in the datapath* rather
   * than the contents of each register: the input side is x^0, and every delay advances
   * the power by one, so the wire leaving stage p carries x^(p+1). Read that way the tap
   * positions line up directly with the terms of g(x) — an XOR labelled x^i sits exactly
   * where g has an x^i term — and the final label x^r marks where feedback originates.
   */
  label: string;
}

export interface XorGate {
  /** Visual position of the stage this gate feeds. */
  position: number;
  /** The polynomial term that put it here; null for the message-input gate. */
  power: number | null;
  cx: number;
  cy: number;
  r: number;
  kind: 'tap' | 'message';
}

export interface Wire {
  d: string;
  kind: 'data' | 'feedback' | 'input' | 'output';
}

export interface CircuitLabel {
  x: number;
  y: number;
  text: string;
  anchor: 'start' | 'middle' | 'end';
  kind: 'stage' | 'io' | 'note';
}

export interface CircuitLayout {
  architecture: LfsrArchitecture;
  generator: Bits;
  stages: StageBox[];
  gates: XorGate[];
  wires: Wire[];
  labels: CircuitLabel[];
  width: number;
  height: number;
  /** Mid-line y of the datapath. */
  midY: number;
}

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

export function layoutLfsr(generator: Bits, architecture: LfsrArchitecture = 'systematic'): CircuitLayout {
  const g = normalize(generator);
  if (isZero(g)) throw new Error('Generator polynomial cannot be zero');
  const r = g.length - 1;
  if (r < 1) throw new Error('Generator polynomial must have degree >= 1');

  // coefficient of x^p, for p = 0..r-1 (the leading x^r term is the register itself).
  const coeff = (p: number): Bit => g[g.length - 1 - p] as Bit;

  const midY = ROW_Y + CELL_H / 2;

  const stages: StageBox[] = [];
  const gates: XorGate[] = [];
  const wires: Wire[] = [];
  const labels: CircuitLabel[] = [];

  // --- Place stages and tap gates, accumulating x ----------------------------
  let x = MARGIN_LEFT;
  /** Centre of the gap before stage 0 — the x^0 point, gate or not. */
  let originX = MARGIN_LEFT;
  for (let p = 0; p < r; p++) {
    // The leftmost junction only needs a gate when something is combined there:
    // the message (external form) or a genuine tap on a later stage.
    const isLeftEdge = p === 0;
    const needsGate =
      coeff(p) === 1 && (!isLeftEdge || architecture === 'external');

    const gapW = needsGate ? GAP_XOR : GAP_PLAIN;
    if (needsGate) {
      gates.push({ position: p, power: p, cx: x + gapW / 2, cy: midY, r: XOR_R, kind: 'tap' });
    }
    if (p === 0) originX = x + gapW / 2;
    x += gapW;

    stages.push({
      position: p,
      regIndex: r - 1 - p,
      power: p,
      x,
      y: ROW_Y,
      width: CELL_W,
      height: CELL_H,
      // The point after this stage carries x^(p+1) — see the field's doc comment.
      label: `x${superscript(p + 1)}`,
    });
    x += CELL_W;
  }

  const lastStage = stages[stages.length - 1];
  const rightEdge = lastStage.x + lastStage.width;
  const busTurnX = rightEdge + 44;
  const width = busTurnX + MARGIN_RIGHT;
  const height = BUS_Y + BOTTOM_PAD;

  // --- Datapath wires between stages ----------------------------------------
  let cursor = MARGIN_LEFT;
  for (const stage of stages) {
    const gate = gates.find((gt) => gt.position === stage.position);
    if (gate) {
      wires.push({ d: `M ${cursor} ${midY} H ${gate.cx - gate.r}`, kind: 'data' });
      wires.push({ d: `M ${gate.cx + gate.r} ${midY} H ${stage.x}`, kind: 'data' });
    } else {
      wires.push({ d: `M ${cursor} ${midY} H ${stage.x}`, kind: 'data' });
    }
    cursor = stage.x + stage.width;
  }

  // --- Feedback bus: right end, up, back across, down into each tap gate -----
  const messageGate: XorGate | null =
    architecture === 'systematic'
      ? { position: -1, power: null, cx: busTurnX, cy: midY, r: XOR_R, kind: 'message' }
      : null;

  if (messageGate) {
    // Systematic: the message is XORed into the feedback line after the last stage.
    gates.push(messageGate);
    wires.push({ d: `M ${rightEdge} ${midY} H ${messageGate.cx - messageGate.r}`, kind: 'data' });
    // Output tap continues to the right edge.
    wires.push({ d: `M ${messageGate.cx + messageGate.r} ${midY} H ${width - 34}`, kind: 'output' });
    // Message arrives from above — the bus occupies the space below.
    wires.push({
      d: `M ${messageGate.cx} 24 V ${messageGate.cy - messageGate.r}`,
      kind: 'input',
    });
    labels.push({
      x: messageGate.cx,
      y: 16,
      text: 'message in',
      anchor: 'middle',
      kind: 'io',
    });
    // Feedback descends from the message gate so it carries (out XOR message).
    wires.push({ d: `M ${messageGate.cx} ${midY + messageGate.r} V ${BUS_Y}`, kind: 'feedback' });
  } else {
    wires.push({ d: `M ${rightEdge} ${midY} H ${width - 34}`, kind: 'output' });
    wires.push({ d: `M ${busTurnX} ${midY} V ${BUS_Y}`, kind: 'feedback' });
  }

  const tapGates = gates.filter((gt) => gt.kind === 'tap');
  const busLeftX = tapGates.length ? Math.min(...tapGates.map((gt) => gt.cx)) : busTurnX;
  const busRightX = messageGate ? messageGate.cx : busTurnX;
  wires.push({ d: `M ${busRightX} ${BUS_Y} H ${busLeftX}`, kind: 'feedback' });

  for (const gate of tapGates) {
    // Feedback rises into each gate from the bus below.
    wires.push({ d: `M ${gate.cx} ${BUS_Y} V ${gate.cy + gate.r}`, kind: 'feedback' });
  }

  // --- Input / output labels -------------------------------------------------
  if (architecture === 'external') {
    wires.push({ d: `M 34 ${midY} H ${MARGIN_LEFT}`, kind: 'input' });
    labels.push({ x: 30, y: midY - 10, text: 'shifted message', anchor: 'end', kind: 'io' });
    labels.push({ x: 30, y: midY + 6, text: 'm(x)·xʳ', anchor: 'end', kind: 'note' });
  }
  labels.push({
    x: width - 30,
    y: midY - 10,
    text: architecture === 'external' ? 'quotient out' : 'out',
    anchor: 'end',
    kind: 'io',
  });
  // Caption the bus below its own line, clear of the drop wires.
  labels.push({
    x: (busLeftX + busRightX) / 2,
    y: BUS_Y + 17,
    text: 'feedback',
    anchor: 'middle',
    kind: 'note',
  });

  // One label per *point* on the datapath, never per element: x^0 before the first stage,
  // then x^(p+1) just after stage p. A gate sitting at one of these points is exactly a
  // term of g(x), so the gate needs no label of its own — labelling both would print the
  // same power twice at two different x-coordinates.
  labels.push({ x: originX, y: LABEL_Y, text: 'x⁰', anchor: 'middle', kind: 'stage' });
  for (const stage of stages) {
    labels.push({
      x: stage.x + stage.width,
      y: LABEL_Y,
      text: stage.label,
      anchor: 'middle',
      kind: 'stage',
    });
  }

  return { architecture, generator: g, stages, gates, wires, labels, width, height, midY };
}

/* ------------------------------------------------------------------ *
 * Static SVG string
 * ------------------------------------------------------------------ */

export interface RenderOptions {
  /** Current register contents, `reg[0]` first — rendered inside the flip-flops. */
  register?: Bits;
  /** Highlight the stages that changed on the last clock. */
  highlight?: number[];
  title?: string;
}

/**
 * Render the layout to a standalone SVG string.
 *
 * All colours go through CSS custom properties so the diagram follows the page theme;
 * the `currentColor` fallbacks keep it legible if the variables are missing.
 */
export function renderLfsrSvg(layout: CircuitLayout, opts: RenderOptions = {}): string {
  const { register, highlight = [] } = opts;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" ` +
      `width="${layout.width}" height="${layout.height}" role="img" ` +
      `aria-label="${escapeXml(opts.title ?? 'CRC shift register')}" class="lfsr-svg">`,
  );

  parts.push(`<defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--circuit-line, currentColor)"/>
    </marker>
  </defs>`);

  for (const wire of layout.wires) {
    const stroke =
      wire.kind === 'feedback' ? 'var(--circuit-feedback, currentColor)' : 'var(--circuit-line, currentColor)';
    const dash = wire.kind === 'feedback' ? ' stroke-dasharray="5 3"' : '';
    const marker = wire.kind === 'output' || wire.kind === 'input' ? ' marker-end="url(#arrow)"' : '';
    parts.push(
      `<path d="${wire.d}" fill="none" stroke="${stroke}" stroke-width="1.6"${dash}${marker}/>`,
    );
  }

  for (const gate of layout.gates) {
    const fill = gate.kind === 'message' ? 'var(--circuit-gate-alt, transparent)' : 'var(--circuit-gate, transparent)';
    parts.push(
      `<circle cx="${gate.cx}" cy="${gate.cy}" r="${gate.r}" fill="${fill}" ` +
        `stroke="var(--circuit-line, currentColor)" stroke-width="1.6"/>`,
      `<path d="M ${gate.cx - 6} ${gate.cy} h 12 M ${gate.cx} ${gate.cy - 6} v 12" ` +
        `stroke="var(--circuit-line, currentColor)" stroke-width="1.6"/>`,
    );
  }

  for (const stage of layout.stages) {
    const active = highlight.includes(stage.position);
    const fill = active ? 'var(--circuit-cell-active, transparent)' : 'var(--circuit-cell, transparent)';
    parts.push(
      `<rect x="${stage.x}" y="${stage.y}" width="${stage.width}" height="${stage.height}" rx="4" ` +
        `fill="${fill}" stroke="var(--circuit-line, currentColor)" stroke-width="1.6"/>`,
    );
    if (register && register[stage.regIndex] !== undefined) {
      parts.push(
        `<text x="${stage.x + stage.width / 2}" y="${stage.y + stage.height / 2 + 6}" ` +
          `text-anchor="middle" font-size="17" font-weight="600" font-family="ui-monospace, monospace" ` +
          `fill="var(--circuit-value, currentColor)">${register[stage.regIndex]}</text>`,
      );
    }
  }

  for (const label of layout.labels) {
    const fill =
      label.kind === 'note'
        ? 'var(--circuit-muted, currentColor)'
        : 'var(--circuit-text, currentColor)';
    parts.push(
      `<text x="${label.x}" y="${label.y}" text-anchor="${label.anchor}" font-size="12" ` +
        `font-family="ui-sans-serif, system-ui, sans-serif" fill="${fill}">${escapeXml(label.text)}</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
