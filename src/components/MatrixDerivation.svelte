<script lang="ts">
  import PolynomialPicker from './PolynomialPicker.svelte';
  import DivisionTable from './DivisionTable.svelte';
  import Polynomial from './Polynomial.svelte';
  import { buildGeneratorMatrix, minimumDistance } from '../lib/generator-matrix';
  import { type Bits } from '../lib/gf2';

  let generator = $state<Bits | null>(null);
  let polyError = $state<string | null>(null);
  let k = $state(4);
  let openRow = $state<number | null>(0);

  const result = $derived.by(() => {
    if (!generator) return null;
    try {
      return buildGeneratorMatrix(generator, k);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  });

  const g = $derived(result && !('error' in result) ? result : null);

  const dmin = $derived.by(() => {
    if (!g) return null;
    try {
      return minimumDistance(g.systematic);
    } catch {
      return null; // k too large for brute force
    }
  });
</script>

<div class="card">
  <div class="card-title">Generator polynomial</div>
  <PolynomialPicker bind:bits={generator} bind:error={polyError} presetId="crc3-gsm" />
</div>

<div class="card">
  <div class="card-title">Message length</div>
  <div class="controls">
    <div class="field" style="max-width:180px">
      <label for="k-input">k (message bits)</label>
      <input id="k-input" type="number" min="1" max="24" bind:value={k} />
    </div>
    {#if g}
      <p class="note" style="margin:0">
        n = k + r = {g.k} + {g.r} = <strong>{g.n}</strong> → this is an ({g.n}, {g.k}) cyclic code.
      </p>
    {/if}
  </div>
</div>

{#if result && 'error' in result}
  <div class="error-box">{result.error}</div>
{:else if g}
  <div class="card">
    <div class="card-title">Step 1 — Non-systematic G: every row is a shift of g(x)</div>
    <p class="note">
      The code is the set of all multiples of g(x) with degree below n. A basis is therefore
      g(x), g(x)·x, …, g(x)·x<sup>k−1</sup> — literally g(x) slid one place right per row. This is
      where "cyclic" comes from.
    </p>
    <div class="scroll-x">
      <table>
        <tbody>
          {#each g.nonSystematicSteps as step (step.row)}
            <tr>
              <td class="note">row {step.row}</td>
              <td class="mono">
                {#each step.fullRow as bit}<span class="cell" class:on={bit === 1}>{bit}</span>{/each}
              </td>
              <td class="note">g(x)·x<sup>{step.shift}</sup></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="note" style="margin-top:0.9rem">
      Encoding with this basis is a plain polynomial multiply — but the message is scrambled into
      the codeword rather than being visible in it. That is why CRC uses the systematic form below.
    </p>
  </div>

  <div class="card">
    <div class="card-title">Step 2 — Systematic G = [I<sub>k</sub> | P]</div>
    <p class="note">
      A codeword is c(x) = m(x)·x<sup>r</sup> + [m(x)·x<sup>r</sup> mod g(x)] — message shifted up,
      remainder filled into the freed low bits. Feeding in one message bit at a time (m(x) =
      x<sup>k−1−i</sup>) gives row i: the unit vector e<sub>i</sub>, then the r bits of
      x<sup>n−1−i</sup> mod g(x). Click a row to see its division.
    </p>

    <div class="scroll-x">
      <table>
        <tbody>
          {#each g.systematicSteps as step (step.row)}
            <tr>
              <td class="note">row {step.row}</td>
              <td class="mono">
                {#each step.fullRow.slice(0, g.k) as bit}<span class="cell ident" class:on={bit === 1}
                    >{bit}</span
                  >{/each}<span class="divider"></span>{#each step.fullRow.slice(g.k) as bit}<span
                    class="cell parity"
                    class:on={bit === 1}>{bit}</span
                  >{/each}
              </td>
              <td class="note">x<sup>{step.exponent}</sup> mod g(x)</td>
              <td>
                <button onclick={() => (openRow = openRow === step.row ? null : step.row)}>
                  {openRow === step.row ? 'Hide' : 'Show'} division
                </button>
              </td>
            </tr>
            {#if openRow === step.row}
              <tr>
                <td colspan="4" class="expanded">
                  <p class="note">{step.note}</p>
                  <DivisionTable division={step.division} maxSteps={60} />
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>

    <p class="note" style="margin-top:0.9rem">
      Left block (grey) is I<sub>k</sub> — the message appears verbatim. Right block (accent) is P —
      the parity bits, which are exactly the CRC.
    </p>
  </div>

  <div class="card">
    <div class="card-title">Step 3 — Parity-check matrix H = [Pᵀ | I<sub>r</sub>]</div>
    <div class="scroll-x">
      <table>
        <tbody>
          {#each g.parityCheck as row, i}
            <tr>
              <td class="note">row {i}</td>
              <td class="mono">
                {#each row.slice(0, g.k) as bit}<span class="cell parity" class:on={bit === 1}
                    >{bit}</span
                  >{/each}<span class="divider"></span>{#each row.slice(g.k) as bit}<span
                    class="cell ident"
                    class:on={bit === 1}>{bit}</span
                  >{/each}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="note" style="margin-top:0.9rem">
      Each <em>column</em> of H is the syndrome that a flip in that bit position produces. That is
      what makes syndrome decoding work: match the syndrome against the columns and you have located
      a single-bit error.
    </p>
  </div>

  <div class="card">
    <div class="card-title">Step 4 — Self-check: G·Hᵀ must be zero</div>
    <p>
      <span class="status {g.valid ? 'status-ok' : 'status-bad'}">
        {g.valid
          ? `G·Hᵀ = 0 (${g.k}×${g.r} zero matrix) — H is a valid parity-check matrix for G`
          : 'G·Hᵀ ≠ 0 — something is wrong'}
      </span>
    </p>
    <p class="note" style="margin-top:0.9rem">
      Over GF(2), [I | P]·[Pᵀ | I]ᵀ = P + P = 0, since addition is XOR and anything XORed with
      itself vanishes. Every codeword therefore satisfies H·cᵀ = 0, which is the receiver's test.
    </p>
    {#if dmin !== null}
      <p style="margin-top:0.9rem">
        Minimum Hamming distance <strong>d = {dmin}</strong> — detects up to {dmin - 1} bit errors,
        corrects up to {Math.floor((dmin - 1) / 2)}.
      </p>
    {:else}
      <p class="note" style="margin-top:0.9rem">
        Minimum distance is found by brute force over all 2<sup>k</sup> − 1 nonzero messages, so it
        is only computed for k ≤ 16.
      </p>
    {/if}
  </div>

  <div class="card">
    <div class="card-title">The other route</div>
    <p class="note" style="margin:0">
      You can also reach the systematic form by Gaussian elimination over GF(2) on the non-systematic
      G from step 1 — row-reduce the left k columns to the identity. Same matrix, same code. The
      remainder method is shown here instead because it mirrors what CRC hardware actually does:
      divide and keep the remainder. For g(x) = <Polynomial bits={g.generator} /> with k = {g.k}, both
      routes land on the rows above.
    </p>
  </div>
{/if}

<style>
  .cell {
    display: inline-block;
    width: 1.35ch;
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
  .divider {
    display: inline-block;
    width: 0;
    border-left: 2px solid var(--border-strong);
    height: 1.1em;
    vertical-align: middle;
    margin: 0 0.4ch;
  }
  td.expanded {
    background: var(--surface-2);
    white-space: normal;
  }
  td {
    vertical-align: middle;
  }
</style>
