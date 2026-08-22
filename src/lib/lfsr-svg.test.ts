import { describe, it, expect } from 'vitest';
import { layoutLfsr, renderLfsrSvg } from './lfsr-svg';
import { parsePolynomial, stringToBits, POLY_PRESETS } from './gf2';

describe('layoutLfsr', () => {
  it('creates one flip-flop per degree', () => {
    for (const preset of POLY_PRESETS) {
      const g = parsePolynomial(preset.algebraic).bits;
      expect(layoutLfsr(g).stages, preset.label).toHaveLength(preset.width);
    }
  });

  it('maps visual position p to the stage holding x^p', () => {
    const layout = layoutLfsr(stringToBits('10011')); // x^4 + x + 1, r = 4
    expect(layout.stages.map((s) => s.power)).toEqual([0, 1, 2, 3]);
    // Register index runs the other way, since reg[0] is the MSB.
    expect(layout.stages.map((s) => s.regIndex)).toEqual([3, 2, 1, 0]);
  });

  it('labels stages x^1..x^r — the power at the point after each flip-flop', () => {
    const layout = layoutLfsr(stringToBits('1011')); // x^3 + x + 1, r = 3
    expect(layout.stages.map((s) => s.label)).toEqual(['x¹', 'x²', 'x³']);
  });

  it('labels each datapath point exactly once: x^0 then x^1..x^r', () => {
    // Order left-to-right by position; sorting the strings would not work, since the
    // superscript codepoints are not in numeric order (¹ is U+00B9, ⁰ is U+2070).
    const layout = layoutLfsr(stringToBits('1011'), 'external');
    const powers = layout.labels
      .filter((l) => l.kind === 'stage')
      .sort((a, b) => a.x - b.x)
      .map((l) => l.text);
    expect(powers).toEqual(['x⁰', 'x¹', 'x²', 'x³']);
    // No power may appear twice — a gate and the stage after it name the same point.
    expect(new Set(powers).size).toBe(powers.length);
  });

  it('never prints a duplicate power, for any preset or architecture', () => {
    for (const preset of POLY_PRESETS) {
      for (const arch of ['external', 'systematic'] as const) {
        const layout = layoutLfsr(parsePolynomial(preset.algebraic).bits, arch);
        const powers = layout.labels.filter((l) => l.kind === 'stage').map((l) => l.text);
        expect(powers.length, `${preset.label}/${arch}`).toBe(preset.width + 1);
        expect(new Set(powers).size, `${preset.label}/${arch}`).toBe(powers.length);
      }
    }
  });

  it('puts the x^0 label at the first gate, where the input enters', () => {
    const layout = layoutLfsr(stringToBits('1011'), 'external');
    const zero = layout.labels.find((l) => l.text === 'x⁰')!;
    const firstGate = layout.gates
      .filter((g) => g.kind === 'tap')
      .sort((a, b) => a.cx - b.cx)[0];
    expect(zero.x).toBe(firstGate.cx);
  });

  it('puts every power label on one row along the top', () => {
    const layout = layoutLfsr(parsePolynomial('x^16 + x^12 + x^5 + 1').bits, 'external');
    const topRow = layout.labels.filter((l) => l.kind === 'stage');
    const ys = new Set(topRow.map((l) => l.y));
    expect(ys.size).toBe(1);
    // ...and clear of the boxes below them.
    expect([...ys][0]).toBeLessThan(layout.stages[0].y);
  });

  it('routes the feedback bus below the datapath, leaving the top for labels', () => {
    const layout = layoutLfsr(stringToBits('1011'), 'external');
    const bus = layout.wires.filter((w) => w.kind === 'feedback');
    expect(bus.length).toBeGreaterThan(0);
    const labelY = layout.labels.find((l) => l.kind === 'stage')!.y;
    // Every feedback coordinate sits under the flip-flop row.
    for (const w of bus) {
      const ys = [...w.d.matchAll(/[VM]\s*(?:[\d.]+\s+)?([\d.]+)/g)].map((m) => Number(m[1]));
      expect(Math.max(...ys)).toBeGreaterThan(labelY);
    }
  });

  it('places a tap gate exactly where g has a term', () => {
    // x^4 + x + 1 -> terms below the leading one are x^1 and x^0.
    const layout = layoutLfsr(stringToBits('10011'), 'external');
    const tapPowers = layout.gates.filter((g) => g.kind === 'tap').map((g) => g.power).sort();
    expect(tapPowers).toEqual([0, 1]);
  });

  it('places gates for a sparse wide polynomial', () => {
    // x^16 + x^12 + x^5 + 1
    const layout = layoutLfsr(parsePolynomial('x^16 + x^12 + x^5 + 1').bits, 'external');
    expect(layout.gates.filter((g) => g.kind === 'tap').map((g) => g.power).sort((a, b) => a! - b!))
      .toEqual([0, 5, 12]);
    expect(layout.stages).toHaveLength(16);
  });

  it('omits the left-edge gate in systematic form, where there is nothing to combine', () => {
    const g = stringToBits('10011');
    const external = layoutLfsr(g, 'external');
    const systematic = layoutLfsr(g, 'systematic');
    expect(external.gates.some((gt) => gt.kind === 'tap' && gt.power === 0)).toBe(true);
    expect(systematic.gates.some((gt) => gt.kind === 'tap' && gt.power === 0)).toBe(false);
  });

  it('adds a message-input gate on the feedback line in systematic form only', () => {
    const g = stringToBits('10011');
    expect(layoutLfsr(g, 'systematic').gates.filter((gt) => gt.kind === 'message')).toHaveLength(1);
    expect(layoutLfsr(g, 'external').gates.filter((gt) => gt.kind === 'message')).toHaveLength(0);
  });

  it('accumulates x-positions rather than assuming a uniform pitch', () => {
    // x^4 + x^3 + x^2 + x + 1 is dense (gate before every stage);
    // x^4 + 1 is sparse. Dense must be wider despite equal stage counts.
    const dense = layoutLfsr(parsePolynomial('x^4 + x^3 + x^2 + x + 1').bits, 'external');
    const sparse = layoutLfsr(parsePolynomial('x^4 + 1').bits, 'external');
    expect(dense.stages).toHaveLength(sparse.stages.length);
    expect(dense.width).toBeGreaterThan(sparse.width);
  });

  it('never overlaps stages with the gates that precede them', () => {
    for (const preset of POLY_PRESETS) {
      const g = parsePolynomial(preset.algebraic).bits;
      for (const arch of ['external', 'systematic'] as const) {
        const layout = layoutLfsr(g, arch);
        for (const stage of layout.stages) {
          const gate = layout.gates.find((gt) => gt.kind === 'tap' && gt.position === stage.position);
          if (gate) {
            expect(gate.cx + gate.r, `${preset.label}/${arch} p=${stage.position}`).toBeLessThanOrEqual(stage.x);
          }
        }
        // Stages are strictly left-to-right and never touch.
        for (let i = 1; i < layout.stages.length; i++) {
          const prev = layout.stages[i - 1];
          expect(prev.x + prev.width).toBeLessThan(layout.stages[i].x);
        }
      }
    }
  });

  it('keeps every element inside the declared viewBox', () => {
    for (const preset of POLY_PRESETS) {
      const layout = layoutLfsr(parsePolynomial(preset.algebraic).bits, 'systematic');
      for (const s of layout.stages) {
        expect(s.x + s.width, preset.label).toBeLessThanOrEqual(layout.width);
        expect(s.y + s.height).toBeLessThanOrEqual(layout.height);
      }
      for (const g of layout.gates) {
        expect(g.cx + g.r).toBeLessThanOrEqual(layout.width);
        expect(g.cy + g.r).toBeLessThanOrEqual(layout.height);
      }
    }
  });

  it('keeps label text inside the viewBox, allowing for ascenders', () => {
    // A baseline near y=0 clips the text against the top edge. Reserve a font's worth.
    const ASCENDER = 12;
    for (const preset of POLY_PRESETS) {
      for (const arch of ['external', 'systematic'] as const) {
        const layout = layoutLfsr(parsePolynomial(preset.algebraic).bits, arch);
        for (const label of layout.labels) {
          expect(label.y, `${preset.label}/${arch} "${label.text}"`).toBeGreaterThanOrEqual(ASCENDER);
          expect(label.y, `${preset.label}/${arch} "${label.text}"`).toBeLessThanOrEqual(layout.height);
        }
      }
    }
  });

  it('never overlaps two labels, for any preset or architecture', () => {
    for (const preset of POLY_PRESETS) {
      for (const arch of ['external', 'systematic'] as const) {
        const labels = layoutLfsr(parsePolynomial(preset.algebraic).bits, arch).labels;
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) {
            const a = labels[i];
            const b = labels[j];
            const collides = Math.abs(a.x - b.x) < 14 && Math.abs(a.y - b.y) < 12;
            expect(
              collides,
              `${preset.label}/${arch}: "${a.text}" overlaps "${b.text}"`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('rejects degenerate generators', () => {
    expect(() => layoutLfsr([0, 0])).toThrow(/cannot be zero/);
    expect(() => layoutLfsr([1])).toThrow(/degree >= 1/);
  });
});

describe('renderLfsrSvg', () => {
  it('emits a well-formed svg with a viewBox', () => {
    const svg = renderLfsrSvg(layoutLfsr(stringToBits('1011')));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
  });

  it('renders register values into the flip-flops in visual order', () => {
    // reg[0] is the MSB and sits rightmost, so '100' should read 0,0,1 left to right.
    const svg = renderLfsrSvg(layoutLfsr(stringToBits('1011')), { register: stringToBits('100') });
    const values = [...svg.matchAll(/font-weight="600"[^>]*>(\d)</g)].map((m) => m[1]);
    expect(values).toEqual(['0', '0', '1']);
  });

  it('uses CSS custom properties so the diagram follows the page theme', () => {
    const svg = renderLfsrSvg(layoutLfsr(stringToBits('1011')));
    expect(svg).toContain('var(--circuit-line');
    expect(svg).toContain('var(--circuit-feedback');
    // Every colour must have a currentColor fallback.
    for (const m of svg.matchAll(/var\((--circuit-[a-z-]+)([^)]*)\)/g)) {
      expect(m[2], m[1]).not.toBe('');
    }
  });

  it('escapes the accessible label', () => {
    const svg = renderLfsrSvg(layoutLfsr(stringToBits('1011')), { title: 'a<b>&"c"' });
    expect(svg).not.toMatch(/aria-label="[^"]*<b>/);
  });

  it('marks highlighted stages differently', () => {
    const layout = layoutLfsr(stringToBits('1011'));
    const plain = renderLfsrSvg(layout);
    const lit = renderLfsrSvg(layout, { highlight: [0] });
    expect(lit).not.toBe(plain);
    expect(lit).toContain('--circuit-cell-active');
  });

  it('renders every preset without throwing', () => {
    for (const preset of POLY_PRESETS) {
      for (const arch of ['external', 'systematic'] as const) {
        const svg = renderLfsrSvg(layoutLfsr(parsePolynomial(preset.algebraic).bits, arch));
        expect(svg.length, `${preset.label}/${arch}`).toBeGreaterThan(200);
      }
    }
  });
});
