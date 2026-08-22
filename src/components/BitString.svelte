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
        <span class="ruler-group" style={`--w:${g.bits.length}ch`}>{g.start}</span>
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
    font-family: var(--mono);
    display: inline-block;
    max-width: 100%;
  }
  .ruler,
  .bits-row {
    display: flex;
    flex-wrap: wrap;
    row-gap: 0.15rem;
  }
  .ruler {
    column-gap: 0.65em;
  }
  .ruler-group {
    width: var(--w);
    font-size: 0.72em;
    color: var(--text-muted);
    line-height: 1.4;
  }
  .group {
    display: inline-block;
    margin-right: 0.65em;
    white-space: nowrap;
  }
  .group:last-child {
    margin-right: 0;
  }
  .bit {
    letter-spacing: 0.02em;
  }
  .bit.msg {
    color: var(--text);
  }
  .bit.fcs {
    color: var(--accent);
    font-weight: 700;
  }
  .bit.dim {
    color: var(--text-muted);
    opacity: 0.6;
  }
</style>
