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
</script>

<div class="card">
  <div class="card-title">Generator polynomial</div>
  <PolynomialPicker bind:bits={generator} bind:error={polyError} />
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
  <div class="card">
    <div class="card-title">Message</div>
    <div class="controls">
      <div class="field" style="max-width:150px">
        <label for="crc-mode">Input as</label>
        <select id="crc-mode" bind:value={mode}>
          {#each INPUT_MODES as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
        </select>
      </div>
      <div class="field field-grow">
        <label for="crc-input">Data</label>
        <input
          id="crc-input"
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
    {/if}
  </div>

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
      <div class="button-row">
        <button class={method === 'matrix' ? 'primary' : ''} onclick={() => (method = 'matrix')}>
          Generator matrix (m·G)
        </button>
        <button class={method === 'division' ? 'primary' : ''} onclick={() => (method = 'division')}>
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

    {#if guarantees}
      <div class="card">
        <div class="card-title">What this polynomial guarantees</div>
        <ul class="steps">
          <li>Every single-bit error is detected.</li>
          <li>
            Every burst error up to <strong>{guarantees.alwaysDetected} bits</strong> long is detected —
            a burst of length L is x<sup>i</sup>·b(x), and since g(x) has a nonzero constant term it
            cannot divide x<sup>i</sup>, so detection turns on whether g(x) divides b(x), impossible
            when deg(b) &lt; r.
          </li>
          <li>
            A burst of exactly {guarantees.alwaysDetected + 1} bits escapes with probability
            2<sup>−{guarantees.alwaysDetected - 1}</sup> ≈ {guarantees.escapeAtRPlus1.toExponential(2)}.
          </li>
          <li>
            Longer bursts escape with probability 2<sup>−{guarantees.alwaysDetected}</sup> ≈ {guarantees.escapeBeyond.toExponential(
              2,
            )}.
          </li>
        </ul>
      </div>
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
    <div class="card">
      <div class="card-title">Verdict</div>
      <p>
        <span class="status {verified.ok ? 'status-ok' : 'status-bad'}">
          {verified.ok ? 'Remainder is zero — no error detected' : 'Nonzero remainder — error detected'}
        </span>
      </p>
      <dl class="kv" style="margin-top:0.9rem">
        <dt>Message</dt>
        <dd><BitString bits={verified.message} /></dd>
        <dt>FCS received</dt>
        <dd><BitString bits={verified.fcs} segments={[{ from: 0, to: verified.fcs.length, class: 'fcs' }]} /></dd>
        <dt>Remainder</dt>
        <dd><BitString bits={verified.remainder} /></dd>
      </dl>
      {#if verified.ok}
        <p class="note" style="margin-top:0.9rem">
          "No error detected" is not the same as "no error". Undetectable corruptions are exactly
          those whose error pattern E(x) is itself a multiple of g(x) — rare, but not impossible.
        </p>
      {/if}
    </div>

    <div class="card">
      <div class="card-title">Long division — received frame ÷ g(x)</div>
      <DivisionTable division={verified.division} splitAt={verified.message.length} />
    </div>
  {/if}
{/if}

<style>
  .flip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin-top: 0.5rem;
  }
  .bit-btn {
    font-family: var(--mono);
    padding: 0.1rem 0.3rem;
    min-width: 1.6rem;
    border-radius: 3px;
    font-size: 0.9rem;
    background: var(--surface-2);
  }
  .bit-btn.tail {
    color: var(--accent);
    font-weight: 700;
  }
</style>
