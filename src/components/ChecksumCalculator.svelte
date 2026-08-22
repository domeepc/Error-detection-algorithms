<script lang="ts">
  import {
    checksumFromBits,
    verifyFromBits,
    toHex,
    toBinaryString,
    MIN_WORD_BITS,
    MAX_WORD_BITS,
    type ChecksumMode,
  } from '../lib/checksum';
  import { bitsToString, type Bit, type Bits } from '../lib/gf2';
  import { INPUT_MODES, tryParseInput, type InputMode } from '../lib/input';

  let mode = $state<InputMode>('binary');
  let value = $state('1011001110001111010');
  let algorithm = $state<ChecksumMode>('internet');
  let wordBits = $state(8);
  let complement = $state(true);

  /** Corrupted copy of the data bits; null means "as transmitted". */
  let corrupted = $state<Bits | null>(null);

  const parsed = $derived(tryParseInput(value, mode));
  const bits = $derived(parsed.ok ? parsed.data.bits : null);

  const opts = $derived({ wordBits, complement });

  const sent = $derived.by(() => {
    if (!bits) return null;
    try {
      return checksumFromBits(bits, algorithm, opts);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  });

  const good = $derived(sent && !('error' in sent) ? sent : null);

  // Any change to the data or parameters clears the corruption.
  $effect(() => {
    void value;
    void mode;
    void wordBits;
    void algorithm;
    void complement;
    corrupted = null;
  });

  const received = $derived.by(() => {
    if (!good) return null;
    try {
      return checksumFromBits(corrupted ?? good.paddedBits, algorithm, opts);
    } catch {
      return null;
    }
  });

  const verdict = $derived.by(() => {
    if (!good || !corrupted) return null;
    try {
      return verifyFromBits(corrupted, good.checksum, algorithm, opts);
    } catch {
      return null;
    }
  });

  const changedBits = $derived.by(() => {
    if (!good || !corrupted) return new Set<number>();
    const out = new Set<number>();
    corrupted.forEach((b, i) => {
      if (b !== good.paddedBits[i]) out.add(i);
    });
    return out;
  });

  function toggleBit(i: number) {
    if (!good) return;
    const next = [...(corrupted ?? good.paddedBits)] as Bits;
    next[i] = (next[i] ^ 1) as Bit;
    corrupted = next;
  }

  /** Rebuild the bit string from a list of word values. */
  function wordsToBits(words: number[]): Bits {
    return words
      .flatMap((w) => [...toBinaryString(w, wordBits)])
      .map((c) => (c === '1' ? 1 : 0) as Bit);
  }

  /**
   * +1 on one word, −1 on another. The two changes cancel in the sum, so an additive
   * checksum cannot see them — which is the entire point of this control.
   */
  function compensatingPair() {
    if (!good || good.words.length < 2) return;
    const modulus = Math.pow(2, wordBits);
    const words = [...(received ?? good).words];
    words[0] = (words[0] + 1) % modulus;
    words[1] = (words[1] - 1 + modulus) % modulus;
    corrupted = wordsToBits(words);
  }

  /** Swap the first two words. Addition is commutative, so the sum is unchanged. */
  function swapWords() {
    if (!good || good.words.length < 2) return;
    const words = [...(received ?? good).words];
    [words[0], words[1]] = [words[1], words[0]];
    corrupted = wordsToBits(words);
  }

  const dataBitCount = $derived(bits ? bits.length : 0);
</script>

<div class="card">
  <div class="card-title">Algorithm</div>
  <div class="button-row">
    <button class={algorithm === 'internet' ? 'primary' : ''} onclick={() => (algorithm = 'internet')}>
      Internet checksum (RFC 1071)
    </button>
    <button class={algorithm === 'modular' ? 'primary' : ''} onclick={() => (algorithm = 'modular')}>
      Modular sum
    </button>
  </div>

  <div class="controls" style="margin-top:1rem">
    <div class="field" style="max-width:200px">
      <label for="cs-word">Word width: {wordBits} bits</label>
      <input
        id="cs-word"
        type="range"
        min={MIN_WORD_BITS}
        max={MAX_WORD_BITS}
        bind:value={wordBits}
      />
    </div>
    <div class="field" style="max-width:110px">
      <label for="cs-word-n">Exact</label>
      <input id="cs-word-n" type="number" min={MIN_WORD_BITS} max={MAX_WORD_BITS} bind:value={wordBits} />
    </div>
    {#if algorithm === 'modular'}
      <div class="field">
        <label for="cs-comp">
          <input id="cs-comp" type="checkbox" bind:checked={complement} /> Complement the result
        </label>
      </div>
    {/if}
  </div>

  <p class="note" style="margin-top:0.8rem">
    {#if algorithm === 'internet'}
      One's-complement sum with <strong>end-around carry</strong>, then complemented. At 16 bits
      this is exactly what IPv4, ICMP, UDP and TCP use — but the arithmetic is the same at any
      width, and small widths are much easier to follow by hand.
    {:else}
      Carries out of the word are <strong>discarded</strong> rather than folded back. That is
      precisely the weakness the internet checksum's end-around carry avoids.
    {/if}
  </p>
</div>

<div class="card">
  <div class="card-title">Data</div>
  <div class="controls">
    <div class="field" style="max-width:150px">
      <label for="cs-mode">Input as</label>
      <select id="cs-mode" bind:value={mode}>
        {#each INPUT_MODES as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
      </select>
    </div>
    <div class="field field-grow">
      <label for="cs-input">Payload</label>
      <input id="cs-input" type="text" bind:value spellcheck="false" />
    </div>
  </div>

  {#if !parsed.ok}
    <div class="error-box" style="margin-top:0.9rem">{parsed.error}</div>
  {:else if good}
    <p class="note" style="margin-top:0.7rem">
      {dataBitCount} bits
      {#if good.padded}
        → zero-padded with <strong>{good.padBits}</strong> bit{good.padBits === 1 ? '' : 's'} to
        reach {good.paddedBits.length} bits = {good.words.length} whole word{good.words.length === 1
          ? ''
          : 's'} of {wordBits}.
      {:else}
        = exactly {good.words.length} word{good.words.length === 1 ? '' : 's'} of {wordBits}, no
        padding needed.
      {/if}
    </p>
  {/if}
</div>

{#if sent && 'error' in sent}
  <div class="error-box">{sent.error}</div>
{:else if good}
  <div class="card">
    <div class="card-title">Words</div>
    <div class="scroll-x">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th class="mono">Binary</th>
            <th class="mono">Hex</th>
            <th class="mono">Decimal</th>
          </tr>
        </thead>
        <tbody>
          {#each good.wordsBinary as wb, i}
            <tr>
              <td>{i + 1}</td>
              <td class="mono word">
                {#each [...wb] as ch, j}
                  {@const abs = i * wordBits + j}
                  <span class="cell" class:pad={abs >= dataBitCount}>{ch}</span>
                {/each}
              </td>
              <td class="mono">{toHex(good.words[i], wordBits)}</td>
              <td class="mono">{good.words[i]}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if good.padded}
      <p class="note" style="margin-top:0.8rem">
        Greyed bits are the zero padding. It goes on the <em>right</em> so every real bit keeps its
        place value — padding on the left would silently renumber the words.
      </p>
    {/if}
  </div>

  <div class="card">
    <div class="card-title">Step by step</div>
    <div class="scroll-x">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th class="mono">Word</th>
            <th class="mono">Running</th>
            <th class="mono">Raw sum</th>
            <th>Carry</th>
            <th class="mono">After</th>
          </tr>
        </thead>
        <tbody>
          {#each good.steps.slice(0, 64) as step (step.index)}
            <tr>
              <td>{step.index}</td>
              <td class="mono">{step.wordBinary}</td>
              <td class="mono">{toBinaryString(step.before, wordBits)}</td>
              <td class="mono" class:over={step.carried}>
                {step.rawSum.toString(2).padStart(wordBits, '0')}
              </td>
              <td class:carry={step.carried}>{step.carryAction}</td>
              <td class="mono">{step.afterBinary}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if good.steps.length > 64}
      <p class="note">{good.steps.length - 64} further step(s) not shown.</p>
    {/if}
  </div>

  <div class="card">
    <div class="card-title">Result</div>
    <dl class="kv">
      <dt>Sum</dt>
      <dd>{good.sumBinary} &nbsp;<span class="note">{toHex(good.sum, wordBits)}</span></dd>
      <dt>Checksum</dt>
      <dd>
        <strong style="color:var(--accent)">{good.checksumBinary}</strong>
        &nbsp;<span class="note">{toHex(good.checksum, wordBits)}</span>
      </dd>
    </dl>
    {#if algorithm === 'internet' || complement}
      <p class="note" style="margin-top:0.9rem">
        The checksum is the bitwise complement of the sum — every 1 becomes 0 and vice versa. A
        receiver adds it back into the sum and expects all ones, since x + ~x saturates.
      </p>
    {/if}
  </div>

  <div class="card">
    <div class="card-title">Break it</div>
    <p class="note">Click any bit to flip it, or use a preset that defeats the checksum by design:</p>

    <div class="bit-strip" style:--cols={wordBits}>
      {#each (corrupted ?? good.paddedBits) as bit, i}
        <button
          class="bit"
          class:one={bit === 1}
          class:flip={changedBits.has(i)}
          class:pad={i >= dataBitCount}
          class:wordstart={i % wordBits === 0}
          onclick={() => toggleBit(i)}
          title={`bit ${i} (word ${Math.floor(i / wordBits) + 1})`}>{bit}</button
        >
      {/each}
    </div>

    <div class="button-row" style="margin-top:1rem">
      <button onclick={compensatingPair} disabled={good.words.length < 2}>
        Compensating pair (+1 / −1)
      </button>
      <button onclick={swapWords} disabled={good.words.length < 2}>Swap first two words</button>
      <button onclick={() => (corrupted = null)} disabled={!corrupted}>Reset</button>
    </div>

    {#if verdict && received}
      <p style="margin-top:1.1rem">
        <span class="status {verdict.ok ? 'status-bad' : 'status-ok'}">
          {verdict.ok
            ? 'Checksum still passes — corruption NOT detected'
            : 'Checksum fails — corruption detected'}
        </span>
        <span class="status status-warn" style="margin-left:0.5rem">
          {changedBits.size} bit{changedBits.size === 1 ? '' : 's'} changed
        </span>
      </p>

      <dl class="kv" style="margin-top:0.9rem">
        <dt>Receiver computed</dt>
        <dd>{verdict.totalBinary}</dd>
        <dt>Expected</dt>
        <dd>{verdict.expectedBinary}</dd>
        <dt>Check used</dt>
        <dd class="note" style="font-family:var(--sans)">
          {verdict.method === 'sum-including-checksum'
            ? 'sum of words including the checksum field'
            : 'recompute the sum and compare'}
        </dd>
      </dl>

      {#if verdict.ok && changedBits.size > 0}
        <p style="margin-top:0.9rem">
          <strong>The corruption slipped through.</strong> Additive checksums are blind to any set
          of changes that cancel: +1 here and −1 there leaves the sum untouched, and reordering
          whole words changes nothing at all because addition is commutative. A CRC has no such
          symmetry — confirm it on the <a href="/lab">error lab</a>.
        </p>
      {/if}
    {:else}
      <p class="note" style="margin-top:0.9rem">
        Flip a single bit and the checksum will catch it. Then try <em>Compensating pair</em> or
        <em>Swap first two words</em> and watch genuinely corrupted data pass as clean.
      </p>
    {/if}
  </div>
{/if}

<style>
  .word .cell {
    display: inline-block;
    width: 1ch;
  }
  .cell.pad {
    color: var(--border-strong);
  }
  td.over {
    color: var(--warn);
  }
  td.carry {
    color: var(--accent);
    font-weight: 600;
  }
  .bit-strip {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1.9rem));
    gap: 2px;
    margin-top: 0.6rem;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
  }
  .bit {
    font-family: var(--mono);
    padding: 0.15rem 0;
    border-radius: 3px;
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: 0.88rem;
  }
  .bit.one {
    color: var(--text);
    font-weight: 700;
  }
  .bit.pad {
    opacity: 0.45;
    border-style: dashed;
  }
  .bit.flip {
    background: var(--bad);
    border-color: var(--bad);
    color: #fff;
    font-weight: 700;
  }
</style>
