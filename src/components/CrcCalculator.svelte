<script lang="ts">
  import PolynomialPicker from './PolynomialPicker.svelte';
  import DivisionTable from './DivisionTable.svelte';
  import MatrixEncode from './MatrixEncode.svelte';
  import Polynomial from './Polynomial.svelte';
  import BitString from './BitString.svelte';
  import { crcGenerate, crcVerify, burstGuarantees } from '../lib/crc';
  import { bitsToString, stringToBits, type Bits } from '../lib/gf2';
  import { INPUT_MODES, tryParseInput, type InputMode } from '../lib/input';

  let generator = $state<Bits | null>(null);
  let polyError = $state<string | null>(null);

  let tab = $state<'generate' | 'verify'>('generate');
  /** How the codeword is computed for display. Both routes give the same answer. */
  let method = $state<'matrix' | 'division'>('matrix');

  // --- generate ---------------------------------------------------------------
  let mode = $state<InputMode>('binary');
  let value = $state('1101011011');

  const parsedInput = $derived(tryParseInput(value, mode));

  const result = $derived.by(() => {
    if (!parsedInput.ok || !generator) return null;
    try {
      return crcGenerate(parsedInput.data.bits, generator);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  });

  const generated = $derived(result && !('error' in result) ? result : null);

  // --- verify -----------------------------------------------------------------
  let receivedText = $state('');
  let touchedReceived = $state(false);

  // Until the user edits it, mirror whatever was just generated.
  const receivedValue = $derived(
    touchedReceived ? receivedText : generated ? bitsToString(generated.codeword) : '',
  );

  const verification = $derived.by(() => {
    const cleaned = receivedValue.replace(/[\s_]/g, '');
    if (!generator || !cleaned) return null;
    if (!/^[01]+$/.test(cleaned)) return { error: 'Received frame must be binary' } as const;
    try {
      return crcVerify(stringToBits(cleaned), generator);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  });

  const verified = $derived(verification && !('error' in verification) ? verification : null);

  function flipBitInReceived(index: number) {
    const cleaned = receivedValue.replace(/[\s_]/g, '');
    const chars = [...cleaned];
    chars[index] = chars[index] === '1' ? '0' : '1';
    receivedText = chars.join('');
    touchedReceived = true;
  }

  const guarantees = $derived(generator ? burstGuarantees(generator.length - 1) : null);

  /** Share of bursts caught, as a percentage short enough to read at a glance. */
  function caught(escape: number): string {
    return escape >= 0.001 ? (100 * (1 - escape)).toFixed(1) : '> 99.9';
  }
</script>

<div class="setup">
  <div class="card">
    <div class="card-title">Generator polynomial</div>
    <PolynomialPicker bind:bits={generator} bind:error={polyError} />
  </div>

  <div class="card message">
    <div class="card-title">Message</div>
    <div class="controls">
      <div class="field">
        <span class="label" id="crc-mode-l">Input as</span>
        <div class="segmented" role="group" aria-labelledby="crc-mode-l">
          {#each INPUT_MODES as m (m.id)}
            <button class={mode === m.id ? 'primary' : ''} aria-pressed={mode === m.id} onclick={() => (mode = m.id)}>{m.label}</button>
          {/each}
        </div>
      </div>
      <div class="field field-grow">
        <label for="crc-input">Data</label>
        <input
          id="crc-input"
          class="data-input"
          type="text"
          bind:value
          spellcheck="false"
          placeholder={INPUT_MODES.find((m) => m.id === mode)?.placeholder}
        />
      </div>
    </div>

    {#if !parsedInput.ok}
      <div class="error-box" style="margin-top:0.85rem">{parsedInput.error}</div>
    {:else}
      <p class="note" style="margin-top:0.6rem">
        {parsedInput.data.bits.length} bits{parsedInput.data.bytes
          ? ` · ${parsedInput.data.bytes.length} bytes`
          : ''}
      </p>
      {#if parsedInput.data.bits.length <= 64}
        <div class="preview">
          <BitString bits={parsedInput.data.bits} group={4} showRuler={false} />
          {#if parsedInput.data.bits.length <= 24}
            <span class="poly-line">M(x) = <Polynomial bits={parsedInput.data.bits} /></span>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>

<div class="tabs" role="tablist">
  <button role="tab" aria-selected={tab === 'generate'} onclick={() => (tab = 'generate')}>
    Generate
  </button>
  <button role="tab" aria-selected={tab === 'verify'} onclick={() => (tab = 'verify')}>
    Verify a received frame
  </button>
</div>

{#if tab === 'generate'}
{#if result && 'error' in result}
    <div class="error-box">{result.error}</div>
  {:else if generated}
    <div class="card">
      <div class="card-title">Result</div>
      <dl class="kv">
        <dt>Message</dt>
        <dd><BitString bits={generated.message} /></dd>
        <dt>Augmented</dt>
        <dd>
          <BitString
            bits={generated.augmented}
            segments={[
              { from: 0, to: generated.message.length, class: 'msg' },
              { from: generated.message.length, to: generated.augmented.length, class: 'dim' },
            ]}
          />
        </dd>
        <dt>FCS</dt>
        <dd><BitString bits={generated.fcs} segments={[{ from: 0, to: generated.fcs.length, class: 'fcs' }]} /></dd>
        <dt>Codeword</dt>
        <dd>
          <BitString
            bits={generated.codeword}
            segments={[
              { from: 0, to: generated.message.length, class: 'msg' },
              { from: generated.message.length, to: generated.codeword.length, class: 'fcs' },
            ]}
          />
        </dd>
      </dl>
      <p class="note" style="margin-top:0.9rem">
        Appending {generated.width} zeros shifts the message up by x<sup>{generated.width}</sup>,
        leaving exactly {generated.width} low slots free for the remainder. The codeword is then divisible
        by g(x) by construction — which is precisely what the receiver tests.
      </p>
    </div>

    <div class="card">
      <div class="card-title">Method</div>
      <div class="segmented" role="group" aria-label="Method">
        <button class={method === 'matrix' ? 'primary' : ''} aria-pressed={method === 'matrix'} onclick={() => (method = 'matrix')}>
          Generator matrix (m·G)
        </button>
        <button class={method === 'division' ? 'primary' : ''} aria-pressed={method === 'division'} onclick={() => (method = 'division')}>
          Long division
        </button>
      </div>
      <p class="note" style="margin-top:0.8rem">
        Two routes to the identical codeword. The matrix treats the code as a vector space and
        builds the codeword as a linear combination of basis rows; long division is the polynomial
        arithmetic the hardware performs. The site cross-checks one against the other.
      </p>
    </div>

    {#if method === 'matrix'}
      {#if generator}
        <MatrixEncode message={generated.message} {generator} />
      {/if}
    {:else}
      <div class="card">
        <div class="card-title">Long division — message ÷ g(x)</div>
        <p class="note">
          Dividing the augmented message by <Polynomial bits={generator ?? []} />. Each row shows the
          generator XORed in at its alignment, then the working register that results. The bar marks
          where the appended zeros begin — the remainder settles into exactly that space.
        </p>
        <DivisionTable division={generated.division} splitAt={generated.message.length} />
      </div>
    {/if}

    {#if guarantees && generator}
      {@const r = guarantees.alwaysDetected}
      <section class="guarantees" aria-labelledby="g-h">
        <h2 id="g-h">What <Polynomial bits={generator} /> guarantees</h2>
        <div class="stats">
          <div class="stat">
            <span class="stat-label">Any single-bit error</span>
            <span class="stat-value">100<small> %</small></span>
            <div class="stat-bar"><span style="width:100%"></span></div>
            <span class="stat-note">Guaranteed</span>
          </div>
          <div class="stat">
            <span class="stat-label">Bursts up to {r} bits</span>
            <span class="stat-value">100<small> %</small></span>
            <div class="stat-bar"><span style="width:100%"></span></div>
            <span class="stat-note">Guaranteed, since deg b(x) &lt; r</span>
          </div>
          <div class="stat">
            <span class="stat-label">A burst of exactly {r + 1}</span>
            <span class="stat-value">{caught(guarantees.escapeAtRPlus1)}<small> %</small></span>
            <div class="stat-bar"><span style={`width:${(1 - guarantees.escapeAtRPlus1) * 100}%`}></span></div>
            <span class="stat-note">Escapes with 2<sup>−{r - 1}</sup> ≈ {guarantees.escapeAtRPlus1.toExponential(2)}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Longer bursts</span>
            <span class="stat-value">{caught(guarantees.escapeBeyond)}<small> %</small></span>
            <div class="stat-bar"><span style={`width:${(1 - guarantees.escapeBeyond) * 100}%`}></span></div>
            <span class="stat-note">Escapes with 2<sup>−{r}</sup> ≈ {guarantees.escapeBeyond.toExponential(2)}</span>
          </div>
        </div>
        <p class="note">
          A burst of length L is x<sup>i</sup>·b(x). g(x) has a nonzero constant term, so it cannot
          divide x<sup>i</sup>; detection turns on whether g(x) divides b(x) — impossible when
          deg(b) &lt; r.
        </p>
      </section>
    {/if}
  {/if}
{:else}
  <div class="card">
    <div class="card-title">Received frame</div>
    <div class="field">
      <label for="crc-received">Binary frame as received (message + FCS)</label>
      <input
        id="crc-received"
        type="text"
        value={receivedValue}
        spellcheck="false"
        oninput={(e) => {
          receivedText = (e.currentTarget as HTMLInputElement).value;
          touchedReceived = true;
        }}
      />
    </div>
    <div class="button-row" style="margin-top:0.75rem">
      <button
        onclick={() => {
          touchedReceived = false;
          receivedText = '';
        }}
        disabled={!generated}>Reset to generated codeword</button
      >
    </div>

    {#if receivedValue}
      <p class="note" style="margin-top:0.9rem">Click any bit to flip it and watch the remainder react:</p>
      <div class="bits flip-row">
        {#each receivedValue.replace(/[\s_]/g, '') as bit, i}
          <button
            class="bit-btn"
            class:tail={verified && i >= verified.message.length}
            onclick={() => flipBitInReceived(i)}
            title={`bit ${i}`}>{bit}</button
          >
        {/each}
      </div>
    {/if}
  </div>

  {#if verification && 'error' in verification}
    <div class="error-box">{verification.error}</div>
  {:else if verified}
    <div class="banner {verified.ok ? 'banner-ok' : 'banner-bad'}" role="status">
      <div class="banner-head">
        <span class="banner-tag">{verified.ok ? 'No error detected' : 'Error detected'}</span>
      </div>
      <p class="banner-text">
        {verified.ok
          ? 'The remainder is zero, so this frame is accepted.'
          : 'The remainder is not zero, so this frame is rejected.'}
      </p>
      {#if verified.ok}
        <p class="banner-sub">
          "No error detected" is not the same as "no error". Undetectable corruptions are exactly
          those whose error pattern E(x) is itself a multiple of g(x) — rare, but not impossible.
        </p>
      {/if}
    </div>

    <div class="card">
      <div class="card-title">Received frame, split</div>
      <dl class="kv">
        <dt>Message</dt>
        <dd><BitString bits={verified.message} /></dd>
        <dt>FCS received</dt>
        <dd><BitString bits={verified.fcs} segments={[{ from: 0, to: verified.fcs.length, class: 'fcs' }]} /></dd>
        <dt>Remainder</dt>
        <dd>
          <BitString
            bits={verified.remainder}
            segments={verified.remainder.map((b, i) => ({ from: i, to: i + 1, class: b ? 'err' : '' }))}
          />
        </dd>
      </dl>
    </div>

    <div class="card">
      <div class="card-title">Long division — received frame ÷ g(x)</div>
      <DivisionTable division={verified.division} splitAt={verified.message.length} />
    </div>
  {/if}
{/if}

<style>
  .setup {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
    gap: 1rem;
    align-items: start;
  }
  .setup > .card {
    margin: 0;
  }
  @media (max-width: 480px) {
    .setup {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-2);
  }
  .data-input {
    font-size: 1.1rem;
    letter-spacing: 0.08em;
    min-height: 3.25rem;
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 1rem;
    padding: 1rem;
    background: var(--bg);
    border-radius: var(--radius-sm);
  }
  .poly-line {
    font-family: var(--mono);
    font-size: 0.8rem;
    color: var(--text-2);
  }
  .guarantees {
    margin-top: 2.5rem;
  }
  .guarantees h2 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
  }
  .guarantees .note {
    margin-top: 1rem;
    max-width: 48rem;
  }

  .flip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 0.75rem;
  }
  .bit-btn {
    font-family: var(--mono);
    padding: 0;
    min-width: 2.4rem;
    min-height: 2.75rem;
    border-radius: 3px;
    border-color: var(--tile-border);
    font-size: 0.9rem;
    background: var(--tile);
  }
  .bit-btn.tail {
    background: var(--accent-fill);
    border-color: var(--accent-fill);
    color: #fff;
  }
</style>
