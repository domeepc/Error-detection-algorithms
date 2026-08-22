<script lang="ts">
  import PolynomialPicker from './PolynomialPicker.svelte';
  import BitString from './BitString.svelte';
  import { layoutLfsr, renderLfsrSvg } from '../lib/lfsr-svg';
  import { runLfsr, type LfsrArchitecture } from '../lib/lfsr';
  import { crcGenerate } from '../lib/crc';
  import { bitsToString, formatAlgebraic, type Bits } from '../lib/gf2';
  import { tryParseInput, INPUT_MODES, type InputMode } from '../lib/input';

  let generator = $state<Bits | null>(null);
  let polyError = $state<string | null>(null);
  let architecture = $state<LfsrArchitecture>('external');

  let mode = $state<InputMode>('binary');
  let value = $state('1101011011');
  let clock = $state(0);

  const parsedInput = $derived(tryParseInput(value, mode));

  const layout = $derived.by(() => {
    if (!generator) return null;
    try {
      return layoutLfsr(generator, architecture);
    } catch {
      return null;
    }
  });

  const run = $derived.by(() => {
    if (!generator || !parsedInput.ok) return null;
    try {
      return runLfsr(parsedInput.data.bits, generator, architecture);
    } catch {
      return null;
    }
  });

  // Clamp the cursor whenever the run length changes.
  $effect(() => {
    const max = run ? run.clocks.length : 0;
    if (clock > max) clock = max;
  });

  const register = $derived.by(() => {
    if (!run) return null;
    if (clock === 0) return Array(run.stages).fill(0) as Bits;
    return run.clocks[clock - 1].after;
  });

  const current = $derived(run && clock > 0 ? run.clocks[clock - 1] : null);

  /** Stages whose value changed on this clock — highlighted in the diagram. */
  const changed = $derived.by(() => {
    if (!current || !layout) return [];
    return layout.stages
      .filter((s) => current.before[s.regIndex] !== current.after[s.regIndex])
      .map((s) => s.position);
  });

  const svg = $derived(
    layout && register
      ? renderLfsrSvg(layout, {
          register,
          highlight: changed,
          title: `CRC shift register for ${formatAlgebraic(generator ?? [], true)}`,
        })
      : null,
  );

  const expectedCrc = $derived.by(() => {
    if (!generator || !parsedInput.ok) return null;
    try {
      return bitsToString(crcGenerate(parsedInput.data.bits, generator).fcs);
    } catch {
      return null;
    }
  });

  let playing = $state(false);
  let timer: ReturnType<typeof setInterval> | null = null;

  function togglePlay() {
    playing = !playing;
    if (timer) clearInterval(timer);
    if (playing) {
      timer = setInterval(() => {
        if (!run || clock >= run.clocks.length) {
          playing = false;
          if (timer) clearInterval(timer);
          return;
        }
        clock += 1;
      }, 320);
    }
  }

  $effect(() => () => {
    if (timer) clearInterval(timer);
  });
</script>

<div class="card">
  <div class="card-title">Generator polynomial</div>
  <PolynomialPicker bind:bits={generator} bind:error={polyError} presetId="crc4-itu" />
</div>

<div class="card">
  <div class="card-title">Architecture</div>
  <div class="button-row">
    <button
      class={architecture === 'external' ? 'primary' : ''}
      onclick={() => {
        architecture = 'external';
        clock = 0;
      }}>External-XOR (shifted message)</button
    >
    <button
      class={architecture === 'systematic' ? 'primary' : ''}
      onclick={() => {
        architecture = 'systematic';
        clock = 0;
      }}>Systematic (premultiplied)</button
    >
  </div>
  <p class="note" style="margin-top:0.8rem">
    {#if architecture === 'systematic'}
      The message is XORed into the feedback line <em>after</em> the last stage, so the register is
      effectively fed m(x)·x<sup>r</sup>. The CRC is ready after exactly k clocks — no trailing
      zeros. This is what real CRC hardware does.
    {:else}
      The <em>shifted message</em> m(x)·x<sup>r</sup> shifts in at the left and the register performs
      a plain division — the r appended zeros are clocked through as part of the input. This is the
      form drawn in most course notes.
    {/if}
  </p>
</div>

{#if polyError}
  <div class="error-box">{polyError}</div>
{:else if layout}
  <div class="card">
    <div class="card-title">
      Circuit — {layout.stages.length} flip-flops, {layout.gates.filter((g) => g.kind === 'tap').length}
      tap XOR{layout.gates.filter((g) => g.kind === 'tap').length === 1 ? '' : 's'}
    </div>
    <div class="scroll-x diagram">
      {#if svg}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- generated locally by renderLfsrSvg -->
        {@html svg}
      {/if}
    </div>
    <p class="note">
      Labels mark the power of x at each <em>point</em> in the datapath: the input side is
      x<sup>0</sup> and every flip-flop advances the power by one, so the wire leaving the last
      stage is x<sup>r</sup> — which is where the feedback originates. Read that way, an XOR
      labelled x<sup>i</sup> sits exactly where g(x) has an x<sup>i</sup> term, so the gate
      positions can be read straight off the polynomial. The constant term of any usable generator
      is 1, so there is always a gate at x<sup>0</sup>. The dashed line below is the feedback bus.
    </p>
  </div>

  <div class="card">
    <div class="card-title">Clock</div>
    <div class="controls">
      <div class="field field-grow">
        <label for="lfsr-input">Message ({INPUT_MODES.find((m) => m.id === mode)?.label})</label>
        <input
          id="lfsr-input"
          type="text"
          bind:value
          spellcheck="false"
          oninput={() => (clock = 0)}
        />
      </div>
      <div class="field" style="max-width:130px">
        <label for="lfsr-mode">Input as</label>
        <select id="lfsr-mode" bind:value={mode} onchange={() => (clock = 0)}>
          {#each INPUT_MODES as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
        </select>
      </div>
    </div>

    {#if !parsedInput.ok}
      <div class="error-box" style="margin-top:0.9rem">{parsedInput.error}</div>
    {:else if run}
      <div class="field" style="margin-top:1rem">
        <label for="lfsr-clock">Clock {clock} of {run.clocks.length}</label>
        <input id="lfsr-clock" type="range" min="0" max={run.clocks.length} bind:value={clock} />
      </div>

      <div class="button-row" style="margin-top:0.6rem">
        <button onclick={() => (clock = 0)} disabled={clock === 0}>Reset</button>
        <button onclick={() => (clock = Math.max(0, clock - 1))} disabled={clock === 0}>Back</button>
        <button onclick={() => (clock = Math.min(run.clocks.length, clock + 1))} disabled={clock >= run.clocks.length}>
          Step
        </button>
        <button onclick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
        <button onclick={() => (clock = run.clocks.length)} disabled={clock >= run.clocks.length}>
          Run to end
        </button>
      </div>

      <dl class="kv" style="margin-top:1rem">
        <dt>Register</dt>
        <dd>{#if register}<BitString bits={register} showRuler={false} />{/if}</dd>
        {#if current}
          <dt>Input bit</dt>
          <dd>{current.input}{current.flushing ? ' (flush zero)' : ''}</dd>
          <dt>Feedback</dt>
          <dd>{current.feedback} {current.feedback ? '— taps fire' : '— taps idle'}</dd>
          <dt>Shifted out</dt>
          <dd>{current.output}</dd>
        {/if}
      </dl>

      {#if clock === run.clocks.length && expectedCrc}
        <p style="margin-top:1rem">
          <span
            class="status {bitsToString(run.register) === expectedCrc ? 'status-ok' : 'status-bad'}"
          >
            Final register {bitsToString(run.register)}
            {bitsToString(run.register) === expectedCrc ? 'matches' : 'differs from'} the long-division
            FCS {expectedCrc}
          </span>
        </p>
      {/if}

      <p class="note" style="margin-top:1rem">
        The register contents after each clock are the same numbers that appear as the working
        remainder in the long-division table — the circuit and the table are two views of one
        computation.
      </p>
    {/if}
  </div>
{/if}

<style>
  .diagram :global(svg) {
    min-width: 100%;
  }
</style>
