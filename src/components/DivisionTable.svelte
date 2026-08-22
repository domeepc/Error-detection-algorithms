<script lang="ts">
  import type { DivisionResult } from '../lib/gf2';

  interface Props {
    division: DivisionResult;
    /** Where the appended zeros (or the FCS) begin, for the column rule. */
    splitAt?: number | null;
    maxSteps?: number;
    /** Bits per group for the position ruler and the light group separators. */
    group?: number;
  }

  let { division, splitAt = null, maxSteps = 200, group = 8 }: Props = $props();

  // Only alignments that actually XOR tell you anything; skipped positions just shift.
  let showSkipped = $state(false);

  const visible = $derived(
    (showSkipped ? division.steps : division.steps.filter((s) => s.quotientBit === 1)).slice(0, maxSteps),
  );
  const hidden = $derived(
    (showSkipped ? division.steps.length : division.steps.filter((s) => s.quotientBit === 1).length) -
      visible.length,
  );
  const width = $derived(division.steps.length ? division.steps[0].before.length : 0);

  /** True at every group boundary after the first, so cells get a small separating gap. */
  function isGroupStart(i: number): boolean {
    return group > 0 && i > 0 && i % group === 0;
  }
</script>

<div class="button-row" style="margin-bottom:0.75rem">
  <button onclick={() => (showSkipped = !showSkipped)}>
    {showSkipped ? 'Hide' : 'Show'} skipped alignments ({division.steps.length - division.steps.filter((s) => s.quotientBit === 1).length})
  </button>
</div>

<div class="scroll-x">
  <table class="division">
    <thead>
      <tr>
        <th>Pos</th>
        <th>q</th>
        <th class="mono">
          Working register
          {#if width > 0}
            <div class="line ruler" aria-hidden="true">
              {#each Array(width) as _, i}<span
                  class="cell ruler-cell"
                  class:gstart={isGroupStart(i)}
                  class:rule={splitAt !== null && i === splitAt}>{i % group === 0 ? i : ''}</span
                >{/each}
            </div>
          {/if}
        </th>
      </tr>
    </thead>
    <tbody>
      {#each visible as step (step.index)}
        <tr class:skipped={step.quotientBit === 0}>
          <td>{step.index}</td>
          <td class="mono">{step.quotientBit}</td>
          <td class="mono row">
            {#if step.subtrahend}
              <div class="line sub">
                {#each step.subtrahend as bit, i}<span
                    class="cell"
                    class:gen={bit === 1}
                    class:dim={bit === 0}
                    class:gstart={isGroupStart(i)}
                    class:rule={splitAt !== null && i === splitAt}>{bit === 1 ? '1' : '·'}</span
                  >{/each}
              </div>
            {/if}
            <div class="line result">
              {#each step.after as bit, i}<span
                  class="cell"
                  class:done={i <= step.index}
                  class:gstart={isGroupStart(i)}
                  class:rule={splitAt !== null && i === splitAt}>{bit}</span
                >{/each}
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="2"><strong>Rem</strong></td>
        <td class="mono row">
          <div class="line result">
            {#each Array(width - division.remainder.length) as _, i}<span
                class="cell dim"
                class:gstart={isGroupStart(i)}>·</span
              >{/each}{#each division.remainder as bit, j}<span
                class="cell fcs"
                class:gstart={isGroupStart(width - division.remainder.length + j)}>{bit}</span
              >{/each}
          </div>
        </td>
      </tr>
    </tfoot>
  </table>
</div>

{#if hidden > 0}
  <p class="note">{hidden} further step(s) not shown.</p>
{/if}

<style>
  .row {
    padding-top: 0.15rem;
    padding-bottom: 0.15rem;
  }
  .line {
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .sub {
    color: var(--accent);
    border-bottom: 1px solid var(--border-strong);
    padding-bottom: 1px;
  }
  .ruler {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-top: 0.35rem;
  }
  .ruler-cell {
    position: relative;
    overflow: visible;
    font-size: 0.78em;
  }
  .cell {
    display: inline-block;
    width: 1ch;
  }
  .cell.dim {
    color: var(--border-strong);
  }
  .cell.done {
    color: var(--text-muted);
    opacity: 0.55;
  }
  .cell.fcs {
    color: var(--accent);
    font-weight: 700;
  }
  .cell.rule {
    border-left: 2px solid var(--accent);
    margin-left: -1px;
  }
  /* A lighter separator than .rule, purely for grouping bits into readable clusters. */
  .cell.gstart:not(.rule) {
    margin-left: 0.45em;
  }
  tr.skipped {
    opacity: 0.55;
  }
  td,
  th {
    vertical-align: top;
  }
</style>
