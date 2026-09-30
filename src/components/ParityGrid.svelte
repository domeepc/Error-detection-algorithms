<script lang="ts">
  import {
    buildParityBlock,
    bytesToRows,
    parseBinaryRowsDetailed,
    checkParityBlock,
    flipDataBit,
    rectangularBlindSpot,
    type ParityBlock,
    type Parity,
  } from '../lib/vrclrc';
  import { textToBytes } from '../lib/gf2';
  import { byteToChar } from '../lib/input';

  type Source = 'binary' | 'text';

  let source = $state<Source>('binary');
  let binaryText = $state('11100111\n11011101\n00111001\n10101001');
  let text = $state('Net');
  let parity = $state<Parity>('even');
  /** Row width for text mode, and the chunk width when binary input is a single line. */
  let rowWidth = $state(8);
  let padShortRows = $state(true);

  /** Corrupted copy; null means "as transmitted". */
  let received = $state<ParityBlock | null>(null);

  /**
   * Parsing is its own derived value rather than a side effect of building the block:
   * Svelte forbids writing $state from inside a $derived, so `padding` reads from here.
   */
  const parsedRows = $derived.by(() => {
    if (source !== 'binary') return null;
    try {
      return parseBinaryRowsDetailed(binaryText, rowWidth, padShortRows);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  });

  /** Per-row zero padding applied, for the grid to mark. */
  const padding = $derived(
    parsedRows && !('error' in parsedRows) ? parsedRows.padded : [],
  );

  const original = $derived.by(() => {
    try {
      if (source === 'binary') {
        if (!parsedRows) return { error: 'No binary input' } as const;
        if ('error' in parsedRows) return parsedRows;
        if (parsedRows.rows.length > 24) {
          return { error: 'Keep it to 24 rows or fewer so the grid stays readable' } as const;
        }
        return buildParityBlock(parsedRows.rows, { parity, bitsPerRow: parsedRows.width });
      }

      const bytes = textToBytes(text);
      if (bytes.length === 0) return { error: 'Enter at least one character' } as const;
      if (bytes.length > 24) return { error: 'Keep it to 24 characters or fewer' } as const;
      if (rowWidth === 7 && bytes.some((b) => b > 0x7f)) {
        return { error: '7-bit mode needs plain ASCII (no accented or non-Latin characters)' } as const;
      }
      return buildParityBlock(bytesToRows(bytes, rowWidth), { parity, bitsPerRow: rowWidth });
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  });

  const sent = $derived(original && !('error' in original) ? original : null);

  // Any change to the source data resets the corruption.
  $effect(() => {
    void source;
    void binaryText;
    void text;
    void parity;
    void rowWidth;
    void padShortRows;
    received = null;
  });

  const shown = $derived(received ?? sent);

  /** Error shapes on a 5×5 block, indexed row-major; the last one is the rectangle. */
  const COVERAGE = [
    { title: '1 bit', why: 'Its row and its column both turn odd.', flips: [7], caught: true },
    { title: '2 bits', why: 'Same row: two columns flag it. Otherwise the rows do.', flips: [6, 8], caught: true },
    { title: '3 bits', why: 'At least one row or column is left with an odd count.', flips: [6, 8, 16], caught: true },
    { title: '4 bits on a rectangle', why: 'Every touched row and column gets exactly two.', flips: [6, 8, 16, 18], caught: false },
  ];
  const check = $derived(shown ? checkParityBlock(shown) : null);

  const flipped = $derived.by(() => {
    if (!received || !sent) return new Set<string>();
    const out = new Set<string>();
    received.rows.forEach((row, r) =>
      row.forEach((b, c) => {
        if (b !== sent.rows[r][c]) out.add(`${r},${c}`);
      }),
    );
    return out;
  });

  /** Row label: the character it encodes in text mode, otherwise just the index. */
  function rowLabel(r: number): string {
    if (source === 'text') return byteToChar(textToBytes(text)[r] ?? 0);
    return String(r);
  }

  function toggle(r: number, c: number) {
    if (!shown) return;
    received = flipDataBit(shown, r, c);
  }

  function makeBlindSpot() {
    if (!sent || sent.rows.length < 2 || sent.bitsPerRow < 2) return;
    received = rectangularBlindSpot(sent, 0, 1, 0, Math.min(3, sent.bitsPerRow - 1));
  }

  /** Copy the current grid back into the binary box, so a corrupted block can be edited as text. */
  function toBinaryEditor() {
    if (!shown) return;
    binaryText = shown.rows.map((r) => r.join('')).join('\n');
    source = 'binary';
  }
</script>

<div class="card">
  <div class="card-title">Data block</div>

  <div class="segmented" role="group" aria-label="Data block source" style="margin-bottom:1rem">
    <button class={source === 'binary' ? 'primary' : ''} onclick={() => (source = 'binary')}>
      Binary rows
    </button>
    <button class={source === 'text' ? 'primary' : ''} onclick={() => (source = 'text')}>
      Text characters
    </button>
  </div>

  {#if source === 'binary'}
    <div class="controls">
      <div class="field field-grow">
        <label for="pg-binary">One data unit per line — this is what gets a VRC bit</label>
        <textarea id="pg-binary" rows="6" bind:value={binaryText} spellcheck="false"></textarea>
      </div>
      <div class="field" style="max-width:150px">
        <label for="pg-parity-b">Parity</label>
        <select id="pg-parity-b" bind:value={parity}>
          <option value="even">Even</option>
          <option value="odd">Odd</option>
        </select>
      </div>
      <div class="field" style="max-width:150px">
        <label for="pg-width">Split width</label>
        <input id="pg-width" type="number" min="2" max="32" bind:value={rowWidth} />
      </div>
      <div class="field">
        <label for="pg-pad">
          <input id="pg-pad" type="checkbox" bind:checked={padShortRows} /> Zero-pad short rows
        </label>
      </div>
    </div>
    <p class="note" style="margin-top:0.7rem">
      Rows may be any width — not every exercise uses bytes. Paste a single unbroken string and it
      is split into rows of <strong>{rowWidth}</strong> bits.
      {#if padShortRows}
        Short rows are zero-filled on the right to match the widest.
      {:else}
        Padding is off, so a ragged block is reported as an error rather than being silently fixed.
      {/if}
    </p>
    {#if padding.length > 0}
      <p class="note" style="margin-top:0.5rem">
        Zero-padded:
        {padding.map((p) => `row ${p.row} (+${p.bits})`).join(', ')} — shown dimmed in the grid.
      </p>
    {/if}
  {:else}
    <div class="controls">
      <div class="field field-grow">
        <label for="pg-text">Characters — one per row</label>
        <input id="pg-text" type="text" bind:value={text} spellcheck="false" />
      </div>
      <div class="field" style="max-width:150px">
        <label for="pg-parity-t">Parity</label>
        <select id="pg-parity-t" bind:value={parity}>
          <option value="even">Even</option>
          <option value="odd">Odd</option>
        </select>
      </div>
      <div class="field" style="max-width:160px">
        <label for="pg-bits">Bits per char</label>
        <select
          id="pg-bits"
          value={String(rowWidth)}
          onchange={(e) => (rowWidth = Number((e.currentTarget as HTMLSelectElement).value))}
        >
          <option value="7">7 (ASCII)</option>
          <option value="8">8 (byte)</option>
        </select>
      </div>
    </div>
  {/if}
</div>

{#if original && 'error' in original}
  <div class="error-box">{original.error}</div>
{:else if shown && sent && check}
  {@const rows = shown.rows.length}
  {@const cols = shown.bitsPerRow}
  {@const missed = check.ok && flipped.size > 0}
  <div class="card">
    <div class="card-title">
      Parity block — {shown.rows.length} rows × {shown.bitsPerRow} bits
    </div>
    <p class="note">
      Each row is one data unit and carries its own VRC bit on the right. The LRC row underneath is
      parity down each column. Click any data bit to flip it — the VRC and LRC bits stay as
      transmitted, which is the point: the receiver compares recomputed parity against what arrived.
    </p>

    <div class="scroll-x">
      <table class="grid">
        <thead>
          <tr>
            <th></th>
            {#each Array(shown.bitsPerRow) as _, c}
              <th class="colhead" class:bad={check.badColumns.includes(c)}>
                b{shown.bitsPerRow - 1 - c}
              </th>
            {/each}
            <th class="sep">VRC</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each shown.rows as row, r}
            <tr>
              <th class="rowhead" class:bad={check.badRows.includes(r)}>{rowLabel(r)}</th>
              {#each row as bit, c}
                {@const padFrom = shown.bitsPerRow - (padding.find((p) => p.row === r)?.bits ?? 0)}
                <td>
                  <button
                    class="bit"
                    class:one={bit === 1}
                    class:flipped={flipped.has(`${r},${c}`)}
                    class:pad={c >= padFrom}
                    onclick={() => toggle(r, c)}
                    title={c >= padFrom ? `row ${r}, column ${c} (padding)` : `row ${r}, column ${c}`}
                    >{bit}</button
                  >
                </td>
              {/each}
              <td class="sep"><span class="parity-bit">{shown.vrc[r]}</span></td>
              <td>
                {#if check.badRows.includes(r)}<span class="mark bad">✗</span>{/if}
              </td>
            </tr>
          {/each}
          <tr class="lrc-row">
            <th class="rowhead">LRC</th>
            {#each shown.lrc as bit}
              <td><span class="parity-bit">{bit}</span></td>
            {/each}
            <td class="sep"><span class="parity-bit corner">{shown.corner}</span></td>
            <td></td>
          </tr>
          <tr>
            <th></th>
            {#each Array(shown.bitsPerRow) as _, c}
              <td>{#if check.badColumns.includes(c)}<span class="mark bad">✗</span>{/if}</td>
            {/each}
            <td class="sep"></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="button-row" style="margin-top:1rem">
      <button onclick={() => (received = null)} disabled={!received}>Reset to transmitted</button>
      <button onclick={makeBlindSpot} disabled={sent.rows.length < 2 || sent.bitsPerRow < 2}>
        Build the rectangular blind spot
      </button>
      <button onclick={toBinaryEditor}>Edit these rows as binary</button>
    </div>

    <dl class="kv" style="margin-top:1rem">
      <dt>LRC (block check character)</dt>
      <dd>{shown.lrc.join('')}</dd>
      <dt>VRC column</dt>
      <dd>{shown.vrc.join('')}</dd>
    </dl>
  </div>

  <div class="banner {missed ? 'banner-bad' : 'banner-ok'}" role="status">
    <div class="banner-head">
      <span class="banner-tag">
        {#if missed}Missed{:else if check.ok}No error detected{:else}Error detected{/if}
      </span>
      {#if flipped.size > 0}
        <span class="banner-chip">{flipped.size} bit{flipped.size === 1 ? '' : 's'} corrupted</span>
      {/if}
    </div>
    <p class="banner-text">
      {#if missed}
        {flipped.size} bits corrupted, 0 of {rows + cols} parity checks failed. The receiver accepts the block.
      {:else if check.ok}
        All parity bits agree.
      {:else}
        Parity mismatch in {check.badRows.length} row{check.badRows.length === 1 ? '' : 's'} and
        {check.badColumns.length} column{check.badColumns.length === 1 ? '' : 's'}.
      {/if}
    </p>
    <div class="banner-stats">
      <span><strong>{rows - check.badRows.length}/{rows}</strong>rows agree</span>
      <span><strong>{cols - check.badColumns.length}/{cols}</strong>columns agree</span>
    </div>
  </div>

  {#if check.correctable}
    <p>
      Exactly one row and one column fail, which pinpoints the flipped bit at
      <strong>row {check.correctable.row}, column {check.correctable.column}</strong>. With a
      single error, 2D parity does not merely detect — it <em>corrects</em>.
    </p>
  {/if}

  {#if missed}
    <p>
      <strong>This is the blind spot.</strong> Every touched row and every touched column gained an
      <em>even</em> number of errors, so all parity bits still agree and the block passes clean
      despite {flipped.size} corrupted bits. A CRC of any reasonable width catches this pattern
      without effort — try the same data on the <a href="/lab">error lab</a>.
    </p>
  {/if}

  {#if !check.ok}
    <dl class="kv">
      <dt>Failing rows</dt>
      <dd>{check.badRows.length ? check.badRows.join(', ') : '—'}</dd>
      <dt>Failing columns</dt>
      <dd>{check.badColumns.length ? check.badColumns.join(', ') : '—'}</dd>
    </dl>
  {/if}

  <section class="coverage" aria-labelledby="cov-h">
    <h2 id="cov-h">What two-dimensional parity guarantees</h2>
    <div class="stats">
      {#each COVERAGE as c (c.title)}
        <div class="stat">
          <div class="mini" aria-hidden="true">
            {#each Array(25) as _, i}<span class="m" class:mf={c.flips.includes(i) && c.caught} class:mx={c.flips.includes(i) && !c.caught}></span>{/each}
          </div>
          <span class="cov-title">{c.title}</span>
          <span class="stat-label">{c.why}</span>
          <span class="tag" class:tag-ok={c.caught} class:tag-bad={!c.caught}>{c.caught ? 'Always caught' : 'Never caught'}</span>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .coverage {
    margin-top: 2.5rem;
  }
  .coverage h2 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
  }
  .mini {
    display: grid;
    grid-template-columns: repeat(5, 16px);
    gap: 3px;
  }
  .m {
    width: 16px;
    height: 16px;
    border: 1px solid var(--tile-border);
    background: var(--tile);
  }
  .m.mf {
    background: var(--ink);
    border-color: var(--ink);
  }
  .m.mx {
    background: var(--bad);
    border-color: var(--bad);
  }
  .cov-title {
    font-weight: 600;
  }
  .tag {
    align-self: flex-start;
    font-family: var(--mono);
    font-size: 0.75rem;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    border: 1px solid;
  }
  .tag-ok {
    background: var(--accent-soft);
    border-color: var(--accent-line);
    color: var(--accent-strong);
  }
  .tag-bad {
    background: var(--bad);
    border-color: var(--bad);
    color: #ffffff;
  }

  textarea {
    font-family: var(--mono);
    resize: vertical;
    letter-spacing: 0.12em;
  }
  table.grid th,
  table.grid td {
    padding: 2px;
    border: none;
    text-align: center;
  }
  .colhead,
  .rowhead {
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--text-muted);
  }
  .colhead.bad,
  .rowhead.bad {
    color: var(--bad-text);
    font-weight: 700;
  }
  .bit {
    font-family: var(--mono);
    width: 2.75rem;
    min-height: 2.75rem;
    padding: 0;
    border-radius: 3px;
    border: 1px solid var(--tile-border);
    background: var(--tile);
    color: var(--text-muted);
    font-size: 0.95rem;
  }
  .bit.one {
    color: var(--text);
    font-weight: 600;
  }
  .bit.flipped {
    background: var(--bad);
    border-color: var(--bad);
    color: #fff;
  }
  .bit.pad {
    background: transparent;
    border-style: dashed;
    color: var(--text-faint);
  }
  .parity-bit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--mono);
    width: 2.75rem;
    height: 2.75rem;
    background: var(--accent-fill);
    color: #fff;
    border-radius: 3px;
    font-weight: 500;
    font-size: 0.95rem;
  }
  .parity-bit.corner {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  .sep {
    padding-left: 0.6rem !important;
  }
  .lrc-row td,
  .lrc-row th {
    padding-top: 0.6rem !important;
  }
  .mark.bad {
    color: var(--bad-text);
    font-weight: 700;
  }
</style>
