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
  <div class="card-title">Architecture and message</div>
  <div class="controls">
    <div class="field">
      <span class="label" id="arch-l">Architecture</span>
      <div class="segmented" role="group" aria-labelledby="arch-l">
        <button
          class={architecture === 'external' ? 'primary' : ''}
          aria-pressed={architecture === 'external'}
          onclick={() => {
            architecture = 'external';
            clock = 0;
          }}>External-XOR (shifted message)</button
        >
        <button
          class={architecture === 'systematic' ? 'primary' : ''}
          aria-pressed={architecture === 'systematic'}
          onclick={() => {
            architecture = 'systematic';
            clock = 0;
          }}>Systematic (premultiplied)</button
        >
      </div>
    </div>
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
  <div class="controls" style="margin-top:1rem">
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
  {/if}
</div>

{#if polyError}
  <div class="error-box">{polyError}</div>
{:else if layout}
  <div class="card instrument">
    <div class="card-title">
      Circuit — {layout.stages.length} flip-flops, {layout.gates.filter((g) => g.kind === 'tap').length}
      tap XOR{layout.gates.filter((g) => g.kind === 'tap').length === 1 ? '' : 's'}
    </div>

    {#if run}
      <div class="tape-head">
        <span>Input stream — next bit outlined</span>
        {#if architecture === 'external'}<span>{run.stages} appended zeros flush the register</span>{/if}
      </div>
      <div class="tape" aria-label={`Input stream, clock ${clock} of ${run.clocks.length}`}>
        {#each run.clocks as c, i}
          <span
            class="tb"
            class:gs={i > 0 && i % 8 === 0}
            class:used={i < clock}
            class:next={i === clock}
            class:flush={c.flushing}>{c.input ?? 0}</span
          >
        {/each}
      </div>
    {/if}

    <div class="scroll-x diagram">
      {#if svg}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- generated locally by renderLfsrSvg -->
        {@html svg}
      {/if}
    </div>

    {#if run}
      <div class="clock-row">
        <div class="clock-buttons" role="group" aria-label="Clock controls">
          <button class="icon" aria-label="Reset to clock 0" onclick={() => (clock = 0)} disabled={clock === 0}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 5v14"></path><path d="M18 6l-8 6 8 6z"></path></svg>
          </button>
          <button class="icon" aria-label="Back one clock" onclick={() => (clock = Math.max(0, clock - 1))} disabled={clock === 0}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
          </button>
          <button class="primary" onclick={() => (clock = Math.min(run.clocks.length, clock + 1))} disabled={clock >= run.clocks.length}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
            Step
          </button>
          <button class="icon" aria-label={playing ? 'Pause' : 'Play'} onclick={togglePlay}>
            {#if playing}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 5v14M16 5v14"></path></svg>
            {:else}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 5l12 7-12 7z"></path></svg>
            {/if}
          </button>
          <button class="icon" aria-label="Run to end" onclick={() => (clock = run.clocks.length)} disabled={clock >= run.clocks.length}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 5v14"></path><path d="M6 6l8 6-8 6z"></path></svg>
          </button>
        </div>
        <div class="field clock-slider">
          <label for="lfsr-clock">Clock {clock} of {run.clocks.length}</label>
          <input id="lfsr-clock" type="range" min="0" max={run.clocks.length} bind:value={clock} />
        </div>
        {#if current}
          <dl class="kv now">
            <dt>Input bit</dt>
            <dd>{current.input ?? 0}{current.flushing ? ' (flush zero)' : ''}</dd>
            <dt>Feedback</dt>
            <dd>{current.feedback} {current.feedback ? '— taps fire' : '— taps idle'}</dd>
            <dt>Shifted out</dt>
            <dd>{current.output}</dd>
          </dl>
        {/if}
      </div>
    {/if}

    <p class="note">
      Labels mark the power of x at each <em>point</em> in the datapath: the input side is
      x<sup>0</sup> and every flip-flop advances the power by one, so the wire leaving the last
      stage is x<sup>r</sup> — which is where the feedback originates. Read that way, an XOR
      labelled x<sup>i</sup> sits exactly where g(x) has an x<sup>i</sup> term, so the gate
      positions can be read straight off the polynomial. The constant term of any usable generator
      is 1, so there is always a gate at x<sup>0</sup>. The dashed line is the feedback bus.
    </p>
  </div>

  {#if run}
    <div class="below">
      <div class="card trace-card">
        <div class="card-title">Clock trace</div>
        <div class="trace-scroll">
          <table class="trace">
            <thead>
              <tr><th>Clock</th><th>In</th><th>Feedback</th><th class="mono">Register after</th><th></th></tr>
            </thead>
            <tbody>
              {#each run.clocks as c (c.clock)}
                {@const later = c.clock > clock}
                <tr class:now={c.clock === clock} class:later>
                  <td class="mono">{c.clock}</td>
                  <td class="mono">{later ? '—' : (c.input ?? 0)}</td>
                  <td class="mono">{later ? '—' : c.feedback}</td>
                  <td class="mono reg">{later ? '···' : bitsToString(c.after)}</td>
                  <td class="tag">{c.clock === clock ? 'now' : c.flushing ? 'flush zero' : ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

      <aside class="side">
        <div class="card final">
          <p class="eyebrow">After clock {run.clocks.length}</p>
          <BitString bits={run.register} showRuler={false} segments={[{ from: 0, to: run.register.length, class: 'fcs' }]} />
          {#if expectedCrc}
            {#if clock === run.clocks.length}
              <span class="status {bitsToString(run.register) === expectedCrc ? 'status-ok' : 'status-bad'}">
                {bitsToString(run.register) === expectedCrc ? 'Matches' : 'Differs from'} the long-division FCS {expectedCrc}
              </span>
            {:else}
              <p class="note">
                Run the clock to the end: the register finishes on {expectedCrc}, the FCS the
                long-division table leaves in its last {run.stages} columns.
              </p>
            {/if}
          {/if}
          <a href="/crc">Compare with the division table</a>
        </div>
        <div class="card">
          <p class="eyebrow">How it maps</p>
          <p class="note" style="margin:0.5rem 0 0">
            Feedback is the bit leaving the last stage. When it is 1, g(x) is XORed in at the taps —
            the division table's q = 1 rows. When it is 0, the register only shifts — a skipped
            alignment.
          </p>
        </div>
      </aside>
    </div>
  {/if}
{/if}

<style>
  .diagram :global(svg) {
    min-width: 100%;
  }
  .diagram {
    margin: 0.5rem 0 1rem;
  }
  .label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-2);
  }
  .tape-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    font-size: 0.8rem;
    color: var(--panel-muted);
    margin-bottom: 0.6rem;
  }
  .tape {
    display: flex;
    flex-wrap: wrap;
    row-gap: 6px;
  }
  .tb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.9rem;
    margin-right: -1px;
    border: 1px solid #c3c9c1;
    background: #ffffff;
    color: #0f1412;
    font-family: var(--mono);
    font-size: 0.78rem;
  }
  .tb.gs {
    margin-left: 7px;
  }
  .tb.used {
    background: #3a443f;
    border-color: #4b5550;
    color: #a9b2ad;
  }
  .tb.flush {
    background: transparent;
    border-style: dashed;
    border-color: #6e7a74;
    color: #c9d0cb;
  }
  .tb.next {
    position: relative;
    z-index: 1;
    outline: 2px solid #9aa8ff;
    outline-offset: 1px;
  }
  .clock-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 1rem 1.5rem;
    padding: 1.25rem 0 1rem;
    border-top: 1px solid var(--panel-line);
  }
  .clock-buttons {
    display: flex;
    gap: 0.5rem;
  }
  .clock-buttons button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .clock-buttons .icon {
    width: 2.75rem;
    padding: 0;
    justify-content: center;
  }
  .clock-slider {
    flex: 1 1 14rem;
  }
  .clock-slider label {
    font-family: var(--mono);
    font-size: 0.8rem;
  }
  .now {
    flex: 0 1 auto;
    font-size: 0.85rem;
    gap: 0.2rem 1rem;
  }
  .below {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-start;
  }
  .below > .card,
  .below > .side {
    margin: 0;
  }
  .trace-card {
    flex: 3 1 30rem;
    min-width: 0;
  }
  .trace-scroll {
    max-height: 28rem;
    overflow: auto;
  }
  .trace {
    width: 100%;
  }
  .trace thead th {
    position: sticky;
    top: 0;
    background: var(--surface);
  }
  .trace td {
    padding: 0.35rem 0.75rem;
  }
  .trace .reg {
    letter-spacing: 0.25em;
  }
  .trace tr.now td {
    background: var(--accent-soft);
  }
  .trace tr.later td {
    color: var(--text-faint);
  }
  .trace .tag {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .side {
    flex: 2 1 18rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .side .card {
    margin: 0;
  }
  .final {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    border-color: var(--ink);
  }
  .final a {
    font-weight: 600;
    font-size: 0.94rem;
  }
</style>
