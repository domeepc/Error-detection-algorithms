<script lang="ts">
  import { buildGeneratorMatrix, encodeSteps } from '../lib/generator-matrix';
  import { crcGenerate } from '../lib/crc';
  import { bitsToString, type Bits } from '../lib/gf2';
  import Polynomial from './Polynomial.svelte';
  import BitString from './BitString.svelte';

  interface Props {
    message: Bits;
    generator: Bits;
  }

  let { message, generator }: Props = $props();

  /** Above this many rows the matrix is summarised rather than drawn in full. */
  const MAX_DRAWN_ROWS = 24;

  let showAllRows = $state(false);
  let basis = $state<'systematic' | 'nonSystematic'>('systematic');

  const built = $derived.by(() => {
    try {
      return buildGeneratorMatrix(generator, message.length);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  });

  const g = $derived(built && !('error' in built) ? built : null);
  const matrix = $derived(g ? (basis === 'systematic' ? g.systematic : g.nonSystematic) : null);

  const trace = $derived.by(() => {
    if (!matrix) return null;
    try {
      return encodeSteps(message, matrix);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  });

  const enc = $derived(trace && !('error' in trace) ? trace : null);

  /** The division result, purely as an independent cross-check. */
  const viaDivision = $derived.by(() => {
    try {
      return crcGenerate(message, generator);
    } catch {
      return null;
    }
  });

  const agrees = $derived(
    enc && viaDivision ? bitsToString(enc.codeword) === bitsToString(viaDivision.codeword) : false,
  );

  const visibleRows = $derived.by(() => {
    if (!g || !matrix) return [];
    const all = matrix.map((row, i) => ({ row, i }));
    return showAllRows || all.length <= MAX_DRAWN_ROWS ? all : all.slice(0, MAX_DRAWN_ROWS);
  });
</script>

{#if built && 'error' in built}
  <div class="error-box">{built.error}</div>
{:else if g && enc && matrix}
  <div class="card">
    <div class="card-title">Basis</div>
    <div class="button-row">
      <button
        class={basis === 'systematic' ? 'primary' : ''}
        onclick={() => (basis = 'systematic')}>Systematic [I | P]</button
      >
      <button
        class={basis === 'nonSystematic' ? 'primary' : ''}
        onclick={() => (basis = 'nonSystematic')}>Non-systematic (shifts of g)</button
      >
    </div>
    <p class="note" style="margin-top:0.8rem">
      {#if basis === 'systematic'}
        G = [I<sub>{g.k}</sub> | P] is {g.k}×{g.n}. Encoding leaves the message visible in the first
        {g.k} columns and puts the CRC in the last {g.r} — the same frame long division produces.
      {:else}
        Every row is g(x) shifted one place further right. This spans the same code, but the message
        is scrambled into the codeword rather than appearing verbatim, so it is not what CRC uses on
        the wire.
      {/if}
    </p>
  </div>

  <div class="card">
    <div class="card-title">Generator matrix G — {g.k} × {g.n}</div>
    <div class="scroll-x">
      <table class="gmat">
        <tbody>
          {#each visibleRows as { row, i } (i)}
            <tr class:selected={enc.steps[i]?.used} class:unused={!enc.steps[i]?.used}>
              <td class="msgbit">
                <span class="chip" class:on={message[i] === 1}>{message[i]}</span>
              </td>
              <td class="note rowlabel">row {i}</td>
              <td class="mono">
                {#each row as bit, j}<span
                    class="cell"
                    class:on={bit === 1}
                    class:parity={basis === 'systematic' && j >= g.k}>{bit}</span
                  >{/each}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if matrix.length > visibleRows.length}
      <div class="button-row" style="margin-top:0.8rem">
        <button onclick={() => (showAllRows = true)}>
          Show all {matrix.length} rows
        </button>
      </div>
      <p class="note">
        Showing {visibleRows.length} of {matrix.length} rows.
      </p>
    {/if}

    <p class="note" style="margin-top:0.9rem">
      The left column is the message. Over GF(2), m·G is not really a multiplication — each message
      bit either <strong>includes its row or does not</strong>, and the included rows are XORed
      together. Rows with a 0 bit are greyed out; they contribute nothing.
    </p>
  </div>

  <div class="card">
    <div class="card-title">Accumulating the XOR</div>
    <div class="scroll-x">
      <table>
        <thead>
          <tr>
            <th>Bit</th>
            <th>Row</th>
            <th class="mono">Running codeword</th>
          </tr>
        </thead>
        <tbody>
          {#each enc.steps.filter((s) => s.used).slice(0, 32) as step (step.row)}
            <tr>
              <td class="mono">1</td>
              <td class="note">row {step.row}</td>
              <td class="mono stack">
                <div class="line sub">
                  {#each step.rowBits as bit}<span class="cell" class:on={bit === 1}
                      >{bit === 1 ? '1' : '·'}</span
                    >{/each}
                </div>
                <div class="line">
                  {#each step.after as bit, j}<span
                      class="cell"
                      class:on={bit === 1}
                      class:parity={basis === 'systematic' && j >= g.k}>{bit}</span
                    >{/each}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if enc.selectedRows.length === 0}
      <p class="note">
        The message is all zeros, so no rows are selected and the codeword is all zeros — the
        all-zero word is a valid codeword of every linear code.
      </p>
    {:else if enc.selectedRows.length > 32}
      <p class="note">{enc.selectedRows.length - 32} further row(s) not shown.</p>
    {/if}
  </div>

  <div class="card">
    <div class="card-title">Result</div>
    <dl class="kv">
      <dt>Rows XORed</dt>
      <dd>{enc.selectedRows.length ? enc.selectedRows.join(' ⊕ ') : '— none —'}</dd>
      <dt>Codeword</dt>
      <dd>
        {#if basis === 'systematic'}
          <BitString
            bits={enc.codeword}
            segments={[
              { from: 0, to: g.k, class: 'msg' },
              { from: g.k, to: enc.codeword.length, class: 'fcs' },
            ]}
          />
        {:else}
          <BitString bits={enc.codeword} />
        {/if}
      </dd>
      {#if basis === 'systematic'}
        <dt>FCS</dt>
        <dd>
          <BitString
            bits={enc.codeword.slice(g.k)}
            segments={[{ from: 0, to: enc.codeword.length - g.k, class: 'fcs' }]}
          />
        </dd>
      {/if}
    </dl>

    {#if viaDivision}
      <p style="margin-top:1rem">
        <span class="status {agrees || basis === 'nonSystematic' ? 'status-ok' : 'status-bad'}">
          {#if basis === 'nonSystematic'}
            Valid codeword, but not the systematic frame — the message is not readable from it
          {:else if agrees}
            Matches long division exactly: {bitsToString(viaDivision.codeword)}
          {:else}
            Disagrees with long division ({bitsToString(viaDivision.codeword)})
          {/if}
        </span>
      </p>
    {/if}

    <p class="note" style="margin-top:1rem">
      Same answer, different route. Long division is what the hardware does one bit at a time;
      the matrix shows the code as a vector space, where a codeword is just a linear combination of
      basis rows. For g(x) = <Polynomial bits={g.generator} /> this is an ({g.n}, {g.k}) cyclic code.
    </p>
  </div>
{:else if trace && 'error' in trace}
  <div class="error-box">{trace.error}</div>
{/if}

<style>
  table.gmat td {
    border: none;
    padding: 1px 6px;
  }
  tr.unused {
    opacity: 0.4;
  }
  tr.selected .rowlabel {
    color: var(--accent);
    font-weight: 700;
  }
  .chip {
    display: inline-block;
    font-family: var(--mono);
    width: 1.5rem;
    text-align: center;
    border-radius: 3px;
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .chip.on {
    background: var(--accent);
    color: #fff;
    font-weight: 700;
  }
  .cell {
    display: inline-block;
    width: 1.25ch;
    text-align: center;
    color: var(--text-muted);
  }
  .cell.on {
    color: var(--text);
    font-weight: 700;
  }
  .cell.parity.on {
    color: var(--accent);
  }
  .stack .line {
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .stack .sub {
    color: var(--accent);
    border-bottom: 1px solid var(--border-strong);
  }
  td {
    vertical-align: middle;
  }
</style>
