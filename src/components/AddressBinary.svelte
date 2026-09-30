<script lang="ts">
  /**
   * 32 bit tiles per address, split into the parent prefix, the bits a split borrowed, and the
   * host bits — the visual that makes "borrowing bits" concrete. Each octet's decimal value
   * sits under it so the dotted form can be read straight off the bits.
   */
  import { binarySplit } from '../lib/subnet';

  interface Props {
    rows: Array<{ label: string; value: number }>;
    /** Length of the parent network portion. */
    parentPrefix: number;
    /** Prefix of the subnet being shown; bits between the two prefixes are the borrowed ones. */
    prefix: number;
  }

  let { rows, parentPrefix, prefix }: Props = $props();

  const lines = $derived(
    rows.map((row) => {
      const split = binarySplit(row.value, parentPrefix, prefix);
      const bits = [...split.network, ...split.subnet, ...split.host];
      const kind = (i: number) => (i < parentPrefix ? 'net' : i < prefix ? 'sub' : 'host');
      const octets = [0, 1, 2, 3].map((o) => ({
        decimal: (row.value >>> (24 - o * 8)) & 255,
        bits: bits.slice(o * 8, o * 8 + 8).map((bit, j) => ({ bit, kind: kind(o * 8 + j) })),
      }));
      return { label: row.label, octets };
    }),
  );

  const borrowed = $derived(prefix - parentPrefix);
</script>

<div class="abin">
  <div class="legend">
    <span><i class="sw net"></i>{borrowed > 0 ? 'Parent prefix' : 'Network'} · {parentPrefix}</span>
    {#if borrowed > 0}<span><i class="sw sub"></i>Borrowed · {borrowed}</span>{/if}
    <span><i class="sw host"></i>Host · {32 - prefix}</span>
  </div>
  <div class="scroll-x">
    <div class="rows">
      {#each lines as line}
        <div class="row">
          <span class="label">{line.label}</span>
          {#each line.octets as octet}
            <span class="octet">
              <span class="bits">
                {#each octet.bits as b}<span class={`b ${b.kind}`}>{b.bit}</span>{/each}
              </span>
              <span class="dec">{octet.decimal}</span>
            </span>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .abin {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.25rem;
    font-size: 0.82rem;
    color: var(--text-2);
  }
  .legend span {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .sw {
    width: 12px;
    height: 12px;
    border: 1px solid var(--tile-border);
  }
  .sw.net {
    background: var(--surface-2);
  }
  .sw.sub {
    background: var(--accent-fill);
    border-color: var(--accent-fill);
  }
  .sw.host {
    border-style: dashed;
    border-color: var(--border-strong);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: max-content;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }
  .label {
    width: 4.5rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.9rem;
  }
  .octet {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
  }
  .bits {
    display: flex;
  }
  .dec {
    font-family: var(--mono);
    font-size: 0.68rem;
    color: var(--text-muted);
  }
  .b {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.45rem;
    height: 1.9rem;
    margin-right: -1px;
    border: 1px solid var(--tile-border);
    font-family: var(--mono);
    font-size: 0.78rem;
  }
  .b.net {
    background: var(--surface-2);
    color: var(--text);
  }
  .b.sub {
    position: relative;
    background: var(--accent-fill);
    border-color: var(--accent-fill);
    color: #ffffff;
  }
  .b.host {
    background: transparent;
    border-style: dashed;
    border-color: var(--border-strong);
    color: var(--text-muted);
  }
</style>
