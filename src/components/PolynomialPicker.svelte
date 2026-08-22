<script lang="ts">
  /**
   * Generator polynomial input.
   *
   * The primary mode is a term builder: click which powers of x are present rather than
   * typing algebraic notation with carets. A degree field sets how many toggle buttons show;
   * the leading term is always on (it defines the degree) and is shown locked. A "Text" tab
   * remains for pasting hex, binary, or algebraic notation directly — useful for wide
   * polynomials like CRC-32, which is past the builder's practical toggle count.
   *
   * Whichever polynomial results, the standard-presets dropdown reflects it by *value*, not
   * by which control was last touched: if the current bits match a preset exactly it is
   * selected, and otherwise the dropdown shows "Custom polynomial" so it's never possible to
   * mistake a hand-built or pasted polynomial for one of the named standards.
   */
  import {
    POLY_PRESETS,
    parsePolynomial,
    formatAlgebraic,
    formatHex,
    bitsToString,
    terms,
    type Bits,
  } from '../lib/gf2';
  import Polynomial from './Polynomial.svelte';

  interface Props {
    /** Bound: the parsed generator, or null while the input is invalid. */
    bits?: Bits | null;
    /** Bound: parse error message, or null. */
    error?: string | null;
    presetId?: string;
  }

  let { bits = $bindable(null), error = $bindable(null), presetId = 'crc4-itu' }: Props = $props();

  const MAX_BUILDER_DEGREE = 32;

  const initialPreset = POLY_PRESETS.find((p) => p.id === presetId) ?? POLY_PRESETS[0];
  const initialBits = parsePolynomial(initialPreset.algebraic).bits;

  let inputMode = $state<'builder' | 'text'>('builder');

  // --- builder state: a degree, and which exponents below it are on ------------
  let degree = $state(initialBits.length - 1);
  let termsOn = $state<Set<number>>(new Set(terms(initialBits).filter((e) => e !== degree)));

  // --- text state: freeform algebraic / binary / 0x hex --------------------------
  let customText = $state(initialPreset.algebraic);
  let hexWidth = $state<number | null>(null);

  /** Build a MSB-first bit array from the builder's degree + optional terms. */
  function bitsFromBuilder(deg: number, on: Set<number>): Bits {
    const out: Bits = Array(deg + 1).fill(0) as Bits;
    out[0] = 1; // the leading term, forced
    for (const e of on) {
      if (e >= 0 && e < deg) out[deg - e] = 1;
    }
    return out;
  }

  function toggleTerm(exp: number) {
    if (exp === degree) return; // leading term is not optional
    const next = new Set(termsOn);
    if (next.has(exp)) next.delete(exp);
    else next.add(exp);
    termsOn = next;
  }

  function setDegree(next: number) {
    if (!Number.isFinite(next)) return;
    const clamped = Math.max(1, Math.min(MAX_BUILDER_DEGREE, Math.round(next)));
    // Drop anything that no longer fits; nothing is invented for newly exposed exponents.
    termsOn = new Set([...termsOn].filter((e) => e < clamped));
    degree = clamped;
  }

  /** Push a resolved polynomial into both input modes, so switching tabs shows it either way. */
  function syncFrom(b: Bits) {
    const exps = terms(b);
    const deg = Math.max(...exps, 0);
    degree = deg;
    termsOn = new Set(exps.filter((e) => e !== deg));
    customText = formatAlgebraic(b);
    hexWidth = null;
  }

  function choosePreset(id: string) {
    const preset = POLY_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    syncFrom(parsePolynomial(preset.algebraic).bits);
  }

  const builderBits = $derived(bitsFromBuilder(degree, termsOn));

  const textParsed = $derived.by(() => {
    try {
      const isHex = /^0x/i.test(customText.trim());
      const p = parsePolynomial(customText, isHex && hexWidth ? { hexWidth } : {});
      return { ok: true as const, bits: p.bits };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  });

  const parsed = $derived.by(():
    | { ok: true; bits: Bits }
    | { ok: false; message: string } => {
    if (inputMode === 'builder') return { ok: true, bits: builderBits };
    return textParsed;
  });

  $effect(() => {
    if (parsed.ok) {
      bits = parsed.bits;
      error = null;
    } else {
      bits = null;
      error = parsed.message;
    }
  });

  /**
   * True whenever the text field currently holds something wider than the builder handles.
   * Independent of which tab is active, so it can gate the "Build by term" tab itself —
   * switching into the builder must never silently swap in stale, unrelated builder state.
   */
  const builderTooWide = $derived(textParsed.ok && textParsed.bits.length - 1 > MAX_BUILDER_DEGREE);

  function switchTo(next: 'builder' | 'text') {
    if (next === inputMode) return;
    if (next === 'builder' && builderTooWide) return;
    if (next === 'text' && parsed.ok) {
      customText = formatAlgebraic(parsed.bits);
      hexWidth = null;
    } else if (next === 'builder' && parsed.ok) {
      syncFrom(parsed.bits);
    }
    inputMode = next;
  }

  const isHexInput = $derived(/^0x/i.test(customText.trim()));

  /** The preset matching the current bits exactly, if any — never based on which control was last touched. */
  const matchedPreset = $derived.by(() => {
    if (!parsed.ok) return null;
    const target = bitsToString(parsed.bits);
    return POLY_PRESETS.find((p) => bitsToString(parsePolynomial(p.algebraic).bits) === target) ?? null;
  });
</script>

<div class="tabs" role="tablist">
  <button
    role="tab"
    aria-selected={inputMode === 'builder'}
    disabled={inputMode !== 'builder' && builderTooWide}
    title={inputMode !== 'builder' && builderTooWide
      ? `Current polynomial is wider than x^${MAX_BUILDER_DEGREE}; stay in text mode`
      : undefined}
    onclick={() => switchTo('builder')}
  >
    Build by term
  </button>
  <button role="tab" aria-selected={inputMode === 'text'} onclick={() => switchTo('text')}>
    Text / hex / binary
  </button>
</div>

<div class="field" style="margin-bottom:0.85rem">
  <label for="poly-preset">Standard polynomial</label>
  <select
    id="poly-preset"
    value={matchedPreset ? matchedPreset.id : 'custom'}
    onchange={(e) => choosePreset((e.currentTarget as HTMLSelectElement).value)}
  >
    <option value="custom" disabled>— Custom polynomial —</option>
    {#each POLY_PRESETS as preset (preset.id)}
      <option value={preset.id}>{preset.label} — {preset.algebraic}</option>
    {/each}
  </select>
</div>

{#if inputMode === 'builder'}
  <div class="controls">
    <div class="field" style="max-width:140px">
      <label for="poly-degree">Degree r</label>
      <input
        id="poly-degree"
        type="number"
        min="1"
        max={MAX_BUILDER_DEGREE}
        value={degree}
        oninput={(e) => setDegree(Number((e.currentTarget as HTMLInputElement).value))}
      />
    </div>
    <p class="note" style="margin:0 0 0.3rem">
      Click the powers of x that g(x) should include. x<sup>{degree}</sup> is the leading term —
      it defines the degree, so it's always on.
    </p>
  </div>

  <div class="term-grid" role="group" aria-label="Terms of g(x)">
    {#each Array(degree + 1) as _, i}
      {@const exp = degree - i}
      <button
        type="button"
        class="term"
        class:on={exp === degree || termsOn.has(exp)}
        class:forced={exp === degree}
        disabled={exp === degree}
        onclick={() => toggleTerm(exp)}
        title={exp === degree ? `x^${exp} — leading term, always present` : `Toggle x^${exp}`}
      >
        {#if exp === 0}1{:else}x<sup>{exp}</sup>{/if}
      </button>
    {/each}
  </div>
{:else}
  <div class="controls">
    <div class="field field-grow">
      <label for="poly-custom">Generator g(x) — algebraic, binary, or 0x hex</label>
      <input id="poly-custom" type="text" bind:value={customText} spellcheck="false" />
    </div>

    {#if isHexInput}
      <div class="field" style="max-width: 140px">
        <label for="poly-width">CRC width</label>
        <input
          id="poly-width"
          type="number"
          min="1"
          max="64"
          placeholder="literal"
          value={hexWidth ?? ''}
          oninput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            hexWidth = v === '' ? null : Number(v);
          }}
        />
      </div>
    {/if}
  </div>

  {#if isHexInput && !hexWidth}
    <p class="note" style="margin-top:0.6rem">
      Hex constants conventionally omit the implied x<sup>width</sup> term, which the value alone
      doesn't carry. Without a width this is read literally — set the width to restore the top bit.
    </p>
  {/if}

  {#if builderTooWide}
    <p class="note" style="margin-top:0.6rem">
      Degree {textParsed.ok ? textParsed.bits.length - 1 : ''} is wider than the term builder
      handles (up to x<sup>{MAX_BUILDER_DEGREE}</sup>) — stay in text mode for this one.
    </p>
  {/if}
{/if}

{#if parsed.ok}
  <dl class="kv" style="margin-top:0.85rem">
    <dt>Parsed as</dt>
    <dd><Polynomial bits={parsed.bits} /></dd>
    <dt>Binary</dt>
    <dd>{bitsToString(parsed.bits)}</dd>
    <dt>Hex</dt>
    <dd>{formatHex(parsed.bits)}</dd>
    <dt>Degree r</dt>
    <dd>{parsed.bits.length - 1} &nbsp;<span class="note">→ {parsed.bits.length - 1}-bit FCS</span></dd>
  </dl>
  {#if matchedPreset}
    <p class="note" style="margin-top:0.6rem">
      Matches the standard <strong>{matchedPreset.label}</strong>. {matchedPreset.note}
    </p>
  {:else}
    <p class="note custom-tag" style="margin-top:0.6rem">Custom polynomial — not one of the standard presets.</p>
  {/if}
{:else}
  <div class="error-box" style="margin-top:0.85rem">{parsed.message}</div>
{/if}

<style>
  .term-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.4rem;
  }
  .term {
    font-family: var(--mono);
    font-size: 0.92rem;
    min-width: 2.6rem;
    padding: 0.35rem 0.5rem;
    border-radius: 6px;
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
    color: var(--text-muted);
  }
  .term:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .term.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 700;
  }
  /* Higher specificity than the plain hover rule above, so an already-on button keeps
     white text on hover instead of orange-on-orange. */
  .term.on:hover:not(:disabled) {
    color: #fff;
  }
  .term.forced {
    cursor: default;
    box-shadow: inset 0 0 0 2px var(--accent-soft);
  }
  .term:disabled {
    opacity: 1;
  }
  .custom-tag {
    font-style: italic;
  }
</style>
