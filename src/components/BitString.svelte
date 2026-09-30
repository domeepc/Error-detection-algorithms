<script lang="ts">
  /**
   * Renders a long bit string grouped into units (default 8, i.e. bytes) with an optional
   * position ruler above it, so a specific bit can be found by counting groups rather than
   * individual characters — and displays that share a `group` size line up visually.
   *
   * `segments` lets a caller colour ranges (message vs. FCS, etc.) without losing grouping;
   * each segment is `{ from, to, class }` over bit *indices* (to exclusive), matching how
   * the rest of the site already slices `Bits` arrays.
   */
  import { chunk, type Bits } from '../lib/gf2';

  interface Segment {
    from: number;
    to: number;
    /** CSS class applied to bits in this range, e.g. 'msg' or 'fcs'. */
    class: string;
  }

  interface Props {
    bits: Bits;
    group?: number;
    showRuler?: boolean;
    segments?: Segment[];
  }

  let { bits, group = 8, showRuler = true, segments = [] }: Props = $props();

  const groups = $derived(chunk(bits, group).map((g, i) => ({ start: i * group, bits: g })));

  function classFor(index: number): string | undefined {
    return segments.find((s) => index >= s.from && index < s.to)?.class;
  }
</script>

<div class="bitstring">
  {#if showRuler}
    <div class="ruler" aria-hidden="true">
      {#each groups as g (g.start)}
        <span class="ruler-group" style={`--n:${g.bits.length}`}>{g.start}</span>
      {/each}
    </div>
  {/if}
  <div class="bits-row">
    {#each groups as g (g.start)}
      <span class="group">
        {#each g.bits as bit, j}
          {@const idx = g.start + j}
          <span class="bit {classFor(idx) ?? ''}">{bit}</span>
        {/each}
      </span>
    {/each}
  </div>
</div>

<style>
  .bitstring {
    --tw: 1.5rem;
    font-family: var(--mono);
    display: inline-block;
    max-width: 100%;
    vertical-align: middle;
  }
  .ruler,
  .bits-row {
    display: flex;
    flex-wrap: wrap;
    row-gap: 0.4rem;
    column-gap: 0.5rem;
  }
  .ruler-group {
    width: calc(var(--n) * (var(--tw) - 1px) + 1px);
    font-size: 0.65rem;
    color: var(--text-muted);
    line-height: 1.6;
    padding-left: 0.2rem;
  }
  .group {
    display: inline-flex;
    white-space: nowrap;
  }
  .bit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--tw);
    height: 1.9rem;
    margin-right: -1px;
    border: 1px solid var(--tile-border);
    background: var(--tile);
    color: var(--text);
    font-size: 0.78rem;
    font-weight: 500;
  }
  .bit:last-child {
    margin-right: 0;
  }
  .bit.fcs {
    position: relative;
    background: var(--accent-fill);
    border-color: var(--accent-fill);
    color: #ffffff;
  }
  .bit.err {
    position: relative;
    background: var(--bad);
    border-color: var(--bad);
    color: #ffffff;
  }
  .bit.dim {
    background: transparent;
    border-style: dashed;
    color: var(--text-muted);
  }
</style>
