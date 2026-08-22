<script lang="ts">
  import PolynomialPicker from './PolynomialPicker.svelte';
  import { crcGenerate, crcVerify } from '../lib/crc';
  import { buildParityBlock, checkParityBlock, type ParityBlock } from '../lib/vrclrc';
  import { checksumFromBits, verifyFromBits, toBinaryString, MAX_WORD_BITS } from '../lib/checksum';
  import {
    applyPattern,
    burstSpan,
    indicesFromPattern,
    patternFromIndices,
    randomBurst,
    randomError,
    type DetectionOutcome,
  } from '../lib/errors';
  import { bitsToString, chunk, padRight, weight, type Bit, type Bits } from '../lib/gf2';
  import { INPUT_MODES, tryParseInput, type InputMode } from '../lib/input';
  import { blindSpotReport, type BlindSpot } from '../lib/undetectable';
  import BitString from './BitString.svelte';

  const MAX_BITS = 256;

  let mode = $state<InputMode>('binary');
  let value = $state('11100111 11011101 00111001 10101001');
  /**
   * Bits per unit. One unit is one row of the parity grid *and* one checksum word, so a
   * single control keeps every scheme looking at the frame the same way.
   */
  let unitWidth = $state(8);

  let generator = $state<Bits | null>(null);
  let polyError = $state<string | null>(null);

  /** The error pattern applied to the data bits. */
  let pattern = $state<Bits | null>(null);
  let burstLength = $state(5);
  let randomCount = $state(4);

  /** Cumulative tally for the burst experiment. */
  let trials = $state({ run: 0, missed: 0, length: 0 });

  const parsed = $derived(tryParseInput(value, mode));

  const source = $derived.by(() => {
    if (!parsed.ok) return { error: parsed.error } as const;
    try {
      const raw = parsed.data.bits;
      if (raw.length === 0) return { error: 'Enter some data first' } as const;
      if (raw.length > MAX_BITS) {
        return { error: `Keep it to ${MAX_BITS} bits or fewer so the grid stays usable` } as const;
      }

      // Zero-pad on the right so the frame fills whole units.
      const remainder = raw.length % unitWidth;
      const padBits = remainder === 0 ? 0 : unitWidth - remainder;
      const bits = padBits === 0 ? raw.slice() : padRight(raw, raw.length + padBits);

      const block = buildParityBlock(chunk(bits, unitWidth), { parity: 'even', bitsPerRow: unitWidth });

      return { bits, block, padBits, dataBits: raw.length };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  });

  const data = $derived(source && !('error' in source) ? source : null);

  // Reset the injected pattern whenever the underlying frame changes.
  $effect(() => {
    void value;
    void mode;
    void unitWidth;
    pattern = null;
    trials = { run: 0, missed: 0, length: 0 };
  });

  const receivedBits = $derived.by(() => {
    if (!data) return null;
    return pattern ? applyPattern(data.bits, pattern) : data.bits;
  });

  /** Rebuild a parity block from possibly-corrupted bits, keeping the transmitted parity. */
  function reblock(bits: Bits, sent: ParityBlock): ParityBlock {
    return { ...sent, rows: chunk(bits, sent.bitsPerRow) };
  }

  const outcomes = $derived.by((): DetectionOutcome[] | null => {
    if (!data || !receivedBits || !generator) return null;
    const out: DetectionOutcome[] = [];

    // --- CRC ---------------------------------------------------------------
    try {
      const sent = crcGenerate(data.bits, generator);
      const received = [...receivedBits, ...sent.fcs];
      const check = crcVerify(received, generator);
      out.push({
        scheme: 'crc',
        label: `CRC (r = ${sent.width})`,
        detected: !check.ok,
        detail: check.ok
          ? `remainder ${'0'.repeat(sent.width)} — passes`
          : `remainder ${bitsToString(check.remainder)} — fails`,
      });
    } catch (e) {
      out.push({ scheme: 'crc', label: 'CRC', detected: false, detail: String(e) });
    }

    // --- VRC / LRC ---------------------------------------------------------
    const recvBlock = reblock(receivedBits, data.block);
    const parityCheck = checkParityBlock(recvBlock);
    out.push({
      scheme: 'vrc',
      label: 'VRC (row parity)',
      detected: parityCheck.badRows.length > 0,
      detail: parityCheck.badRows.length
        ? `rows ${parityCheck.badRows.join(', ')} fail`
        : 'all rows pass',
    });
    out.push({
      scheme: 'lrc',
      label: 'LRC (column parity)',
      detected: parityCheck.badColumns.length > 0,
      detail: parityCheck.badColumns.length
        ? `columns ${parityCheck.badColumns.join(', ')} fail`
        : 'all columns pass',
    });
    out.push({
      scheme: 'vrc+lrc',
      label: 'VRC + LRC combined',
      detected: !parityCheck.ok,
      detail: parityCheck.ok
        ? 'entire block passes'
        : parityCheck.correctable
          ? `pinpoints row ${parityCheck.correctable.row}, column ${parityCheck.correctable.column}`
          : 'block fails',
    });

    // --- Checksum ----------------------------------------------------------
    const sentSum = checksumFromBits(data.bits, 'internet', { wordBits: unitWidth });
    const sumCheck = verifyFromBits(receivedBits, sentSum.checksum, 'internet', {
      wordBits: unitWidth,
    });
    out.push({
      scheme: 'checksum',
      label: `Internet checksum (${unitWidth}-bit words)`,
      detected: !sumCheck.ok,
      detail: sumCheck.ok
        ? `sums to ${sumCheck.totalBinary} — passes`
        : `sums to ${sumCheck.totalBinary}, expected ${sumCheck.expectedBinary} — fails`,
    });

    return out;
  });

  const sentChecksum = $derived(
    data ? checksumFromBits(data.bits, 'internet', { wordBits: unitWidth }) : null,
  );

  const actuallyCorrupt = $derived(pattern ? weight(pattern) > 0 : false);
  const missedBy = $derived(
    outcomes && actuallyCorrupt ? outcomes.filter((o) => !o.detected) : [],
  );

  /* ---------------- injection controls ---------------- */

  function inject(fn: (len: number) => Bits) {
    if (data) pattern = fn(data.bits.length);
  }

  function injectSingle() {
    inject((len) => patternFromIndices(len, [Math.floor(Math.random() * len)]));
  }

  function injectRandom() {
    inject((len) => randomError(len, Math.min(randomCount, len)));
  }

  function injectBurst() {
    inject((len) => randomBurst(len, Math.min(burstLength, len)));
  }

  /**
   * The rectangular blind spot: four flips at the corners of a rectangle in the grid.
   * Every touched row and column gains exactly two errors, so both parities survive.
   * Columns are picked from the actual unit width, not a hardcoded 8.
   */
  function injectRectangle() {
    if (!data || data.block.rows.length < 2 || unitWidth < 2) return;
    const r1 = 0;
    const r2 = 1;
    const c1 = 0;
    const c2 = Math.min(unitWidth - 1, 4);
    pattern = patternFromIndices(data.bits.length, [
      r1 * unitWidth + c1,
      r1 * unitWidth + c2,
      r2 * unitWidth + c1,
      r2 * unitWidth + c2,
    ]);
  }

  function toggleBit(i: number) {
    if (!data) return;
    const current = pattern ? [...pattern] : (Array(data.bits.length).fill(0) as Bits);
    current[i] = (current[i] ^ 1) as Bit;
    pattern = current;
  }

  /** Hammer random bursts of a fixed length and tally how many slip past the CRC. */
  function runBurstTrials(length: number, count = 500) {
    if (!data || !generator) return;
    if (trials.length !== length) trials = { run: 0, missed: 0, length };
    const sent = crcGenerate(data.bits, generator);
    let { run, missed } = trials;
    for (let i = 0; i < count; i++) {
      const p = randomBurst(data.bits.length, Math.min(length, data.bits.length));
      const received = [...applyPattern(data.bits, p), ...sent.fcs];
      if (crcVerify(received, generator).ok) missed += 1;
      run += 1;
    }
    trials = { run, missed, length };
  }

  const r = $derived(generator ? generator.length - 1 : 0);

  /**
   * What each scheme cannot see, for the current frame/generator/unit width — built and
   * verified fresh whenever any of those change, never a static table.
   */
  const catalogue = $derived.by(() => {
    if (!data) return null;
    return blindSpotReport({ bits: data.bits, unitWidth, generator });
  });

  function applyBlindSpot(spot: BlindSpot) {
    pattern = spot.pattern;
  }
</script>

<div class="card">
  <div class="card-title">Frame</div>
  <div class="controls">
    <div class="field" style="max-width:150px">
      <label for="lab-mode">Input as</label>
      <select id="lab-mode" bind:value={mode}>
        {#each INPUT_MODES as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
      </select>
    </div>
    <div class="field field-grow">
      <label for="lab-input">Payload</label>
      <input
        id="lab-input"
        type="text"
        bind:value
        spellcheck="false"
        placeholder={INPUT_MODES.find((m) => m.id === mode)?.placeholder}
      />
    </div>
    <div class="field" style="max-width:150px">
      <label for="lab-unit">Unit width</label>
      <input id="lab-unit" type="number" min="2" max={MAX_WORD_BITS} bind:value={unitWidth} />
    </div>
  </div>

  {#if data}
    <p class="note" style="margin-top:0.7rem">
      {data.dataBits} bits{#if data.padBits > 0}, zero-padded with <strong>{data.padBits}</strong> to
        reach {data.bits.length}{/if} — {data.block.rows.length} rows of {unitWidth} for the parity
      grid, and the same units as checksum words.
      {#if sentChecksum}
        Transmitted checksum <code>{sentChecksum.checksumBinary}</code>.
      {/if}
    </p>
  {/if}
</div>

<div class="card">
  <div class="card-title">CRC generator</div>
  <PolynomialPicker bind:bits={generator} bind:error={polyError} presetId="crc8" />
</div>

{#if source && 'error' in source}
  <div class="error-box">{source.error}</div>
{:else if data}
  <div class="card">
    <div class="card-title">Inject an error</div>
    <div class="button-row">
      <button onclick={injectSingle}>Single bit</button>
      <button onclick={injectRandom}>{randomCount} random bits</button>
      <button onclick={injectBurst}>Burst of {burstLength}</button>
      <button onclick={injectRectangle} disabled={data.block.rows.length < 2 || unitWidth < 2}>
        Rectangular blind spot
      </button>
      <button onclick={() => (pattern = null)} disabled={!pattern}>Clear</button>
    </div>

    <div class="controls" style="margin-top:1rem">
      <div class="field" style="max-width:220px">
        <label for="lab-burst">Burst length: {burstLength}</label>
        <input id="lab-burst" type="range" min="2" max="24" bind:value={burstLength} />
      </div>
      <div class="field" style="max-width:220px">
        <label for="lab-count">Random flips: {randomCount}</label>
        <input id="lab-count" type="range" min="1" max="12" bind:value={randomCount} />
      </div>
    </div>

    <p class="note" style="margin-top:1rem">Click any bit to flip it by hand:</p>
    <!-- style: directive rather than a template-literal style attribute — the latter did
         not re-apply when unitWidth changed, leaving the grid stuck at its first width. -->
    <div class="bit-grid" style:--cols={unitWidth}>
      {#each data.bits as bit, i}
        <button
          class="bit"
          class:one={bit === 1}
          class:flip={pattern?.[i] === 1}
          class:pad={i >= data.dataBits}
          onclick={() => toggleBit(i)}
          title={`bit ${i} (row ${Math.floor(i / unitWidth)}, col ${i % unitWidth})${i >= data.dataBits ? ' — padding' : ''}`}
          >{pattern?.[i] === 1 ? bit ^ 1 : bit}</button
        >
      {/each}
    </div>

    {#if pattern && actuallyCorrupt}
      <dl class="kv" style="margin-top:1rem">
        <dt>Bits flipped</dt>
        <dd>{weight(pattern)} at {indicesFromPattern(pattern).join(', ')}</dd>
        <dt>Burst span</dt>
        <dd>{burstSpan(pattern)} bits</dd>
      </dl>
    {/if}
  </div>

  {#if catalogue}
    <div class="card">
      <div class="card-title">Guaranteed misses for this setup</div>
      <p class="note">
        Built from the current generator, frame length and unit width — every pattern below is
        verified against the scheme's own checker before it is shown, not just asserted from
        theory. Press <strong>Apply</strong> to load one into the injector above and watch
        Detection confirm it.
      </p>

      <div class="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Scheme</th>
              <th>Pattern (bit indices)</th>
              <th>Weight</th>
              <th>Why it's invisible</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each catalogue.schemes as report (report.scheme)}
              {#if report.spots.length === 0}
                <tr>
                  <td><strong>{report.label}</strong></td>
                  <td colspan="4" class="explain">
                    {report.note ?? 'No blind spot found for this frame.'}
                  </td>
                </tr>
              {:else}
                {#each report.spots as spot, i (spot.origin)}
                  <tr>
                    {#if i === 0}
                      <td rowspan={report.spots.length}><strong>{report.label}</strong></td>
                    {/if}
                    <td>
                      <BitString
                        bits={spot.pattern}
                        group={unitWidth}
                        showRuler={false}
                        segments={spot.indices.map((idx) => ({ from: idx, to: idx + 1, class: 'fcs' }))}
                      />
                      <span class="note">bits {spot.indices.join(', ')}</span>
                    </td>
                    <td>{spot.weight}</td>
                    <td class="explain">{spot.explanation}</td>
                    <td><button onclick={() => applyBlindSpot(spot)}>Apply</button></td>
                  </tr>
                {/each}
              {/if}
            {/each}
          </tbody>
        </table>
      </div>

      {#if generator}
        <p class="note" style="margin-top:0.9rem">
          {#if catalogue.crc.period !== null}
            <strong>Period of g(x): {catalogue.crc.period.toLocaleString()}.</strong>
            Two bits that far apart cancel exactly, so a weight-2 CRC blind spot needs a frame
            longer than {catalogue.crc.period.toLocaleString()} bits.
            {#if !catalogue.crc.periodFitsFrame}
              This frame is only {data?.bits.length} bits, so none exists here yet — try a longer
              payload or a polynomial with a shorter period (the small presets are good for this).
            {/if}
          {:else}
            The period of g(x) exceeds {catalogue.crc.periodCap.toLocaleString()}, so no weight-2
            blind spot exists for any frame this side of that length. This is why wide
            polynomials like CRC-16 and CRC-32 are trusted with long frames.
          {/if}
        </p>
      {/if}
    </div>
  {/if}

  {#if polyError}
    <div class="error-box">{polyError}</div>
  {:else if outcomes}
    <div class="card">
      <div class="card-title">Detection</div>
      {#if !actuallyCorrupt}
        <p class="note">Frame is intact — every scheme should pass. Inject an error above.</p>
      {/if}
      <div class="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Scheme</th>
              <th>Verdict</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {#each outcomes as o (o.scheme)}
              <tr>
                <td><strong>{o.label}</strong></td>
                <td>
                  {#if !actuallyCorrupt}
                    <span class="status status-ok">clean</span>
                  {:else if o.detected}
                    <span class="status status-ok">caught</span>
                  {:else}
                    <span class="status status-bad">MISSED</span>
                  {/if}
                </td>
                <td class="detail">{o.detail}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if actuallyCorrupt && missedBy.length > 0}
        <p style="margin-top:1rem">
          <span class="status status-bad">
            {missedBy.length} scheme{missedBy.length === 1 ? '' : 's'} failed to notice
            {weight(pattern!)} corrupted bit{weight(pattern!) === 1 ? '' : 's'}
          </span>
        </p>
        {#if missedBy.some((o) => o.scheme === 'vrc+lrc')}
          <p style="margin-top:0.8rem">
            The four flips sit at the corners of a rectangle, so every affected row and column gained
            exactly <em>two</em> errors. Parity counts only oddness, so it sees nothing. Row and
            column parity together catch all 1-, 2- and 3-bit errors — four is where the pattern
            defeats them, and no amount of extra parity rows fixes it.
          </p>
        {/if}
      {:else if actuallyCorrupt}
        <p class="note" style="margin-top:1rem">Every scheme caught this one. Try the rectangular blind spot.</p>
      {/if}
    </div>

    <div class="card">
      <div class="card-title">Burst experiment</div>
      <p class="note">
        CRC detects <em>every</em> burst up to r = {r} bits. At r + 1 = {r + 1} the escape
        probability is 2<sup>−{r - 1}</sup> = {(Math.pow(2, -(r - 1)) * 100).toPrecision(3)}%, and
        beyond that 2<sup>−{r}</sup>. Run a few thousand trials and watch the tally match.
      </p>
      <div class="button-row" style="margin-top:0.9rem">
        <button onclick={() => runBurstTrials(r, 500)}>500 bursts of {r} (must all be caught)</button>
        <button onclick={() => runBurstTrials(r + 1, 500)}>500 bursts of {r + 1}</button>
        <button onclick={() => runBurstTrials(r + 4, 500)}>500 bursts of {r + 4}</button>
        <button onclick={() => (trials = { run: 0, missed: 0, length: 0 })} disabled={trials.run === 0}>
          Reset tally
        </button>
      </div>

      {#if trials.run > 0}
        <dl class="kv" style="margin-top:1rem">
          <dt>Burst length</dt>
          <dd>{trials.length}</dd>
          <dt>Trials</dt>
          <dd>{trials.run.toLocaleString()}</dd>
          <dt>Escaped</dt>
          <dd>{trials.missed.toLocaleString()} ({((trials.missed / trials.run) * 100).toFixed(3)}%)</dd>
          <dt>Predicted</dt>
          <dd>
            {trials.length <= r
              ? '0% — guaranteed'
              : `${((trials.length === r + 1 ? Math.pow(2, -(r - 1)) : Math.pow(2, -r)) * 100).toPrecision(3)}%`}
          </dd>
        </dl>
        {#if trials.length <= r && trials.missed === 0}
          <p style="margin-top:0.8rem">
            <span class="status status-ok">
              {trials.run.toLocaleString()} bursts of length ≤ r, none escaped — as guaranteed
            </span>
          </p>
        {/if}
      {/if}
    </div>
  {/if}
{/if}

<style>
  .bit-grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 2.1rem));
    gap: 2px;
    margin-top: 0.5rem;
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
  td.detail {
    font-family: var(--mono);
    font-size: 0.82rem;
    color: var(--text-muted);
    white-space: normal;
  }
  td.explain {
    font-size: 0.85rem;
    color: var(--text-muted);
    white-space: normal;
    max-width: 32ch;
  }
</style>
