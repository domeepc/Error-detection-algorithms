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

  <div class="button-row" style="margin-bottom:1rem">
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

  <div class="card">
    <div class="card-title">Verdict</div>
    <p>
      <span class="status {check.ok ? 'status-ok' : 'status-bad'}">
        {check.ok ? 'All parity bits agree — no error detected' : 'Parity mismatch — error detected'}
      </span>
      {#if flipped.size > 0}
        <span class="status status-warn" style="margin-left:0.5rem">
          {flipped.size} bit{flipped.size === 1 ? '' : 's'} actually corrupted
        </span>
      {/if}
    </p>

    {#if check.correctable}
      <p style="margin-top:0.9rem">
        Exactly one row and one column fail, which pinpoints the flipped bit at
        <strong>row {check.correctable.row}, column {check.correctable.column}</strong>. With a
        single error, 2D parity does not merely detect — it <em>corrects</em>.
      </p>
    {/if}

    {#if check.ok && flipped.size > 0}
      <p style="margin-top:0.9rem">
        <strong>This is the blind spot.</strong> Every touched row and every touched column gained an
        <em>even</em> number of errors, so all parity bits still agree and the block passes clean
        despite {flipped.size} corrupted bits. Two-dimensional parity catches all 1-, 2- and 3-bit
        errors, but a rectangle of four defeats it. A CRC of any reasonable width catches this
        pattern without effort — try the same data on the
        <a href="/lab">error lab</a>.
      </p>
    {/if}

    <dl class="kv" style="margin-top:0.9rem">
      <dt>Failing rows</dt>
      <dd>{check.badRows.length ? check.badRows.join(', ') : '—'}</dd>
      <dt>Failing columns</dt>
      <dd>{check.badColumns.length ? check.badColumns.join(', ') : '—'}</dd>
    </dl>
  </div>
{/if}

<style>
  textarea {
    font-family: var(--mono);
    resize: vertical;
    letter-spacing: 0.12em;
  }
  table.grid th,
  table.grid td {
    padding: 2px 3px;
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
    color: var(--bad);
    font-weight: 700;
  }
  .bit {
    font-family: var(--mono);
    width: 2rem;
    padding: 0.15rem 0;
    border-radius: 3px;
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .bit.one {
    color: var(--text);
    font-weight: 700;
  }
  .bit.flipped {
    background: var(--bad);
    border-color: var(--bad);
    color: #fff;
  }
  .bit.pad {
    opacity: 0.45;
    border-style: dashed;
  }
  .parity-bit {
    display: inline-block;
    font-family: var(--mono);
    width: 2rem;
    padding: 0.15rem 0;
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: 3px;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .parity-bit.corner {
    outline: 1px solid var(--accent);
  }
  .sep {
    border-left: 2px solid var(--border-strong) !important;
  }
  .lrc-row {
    border-top: 2px solid var(--border-strong);
  }
  .mark.bad {
    color: var(--bad);
    font-weight: 700;
  }
</style>
