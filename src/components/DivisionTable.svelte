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
  .division td,
  .division th {
    vertical-align: top;
  }
  .division td:first-child,
  .division td:nth-child(2) {
    font-family: var(--mono);
    font-size: 0.78rem;
    line-height: 1.45rem;
  }
  .division tbody td:nth-child(2) {
    color: var(--accent);
    font-weight: 600;
  }
  .row {
    padding-top: 0.4rem;
    padding-bottom: 0.4rem;
  }
  .line {
    display: flex;
    white-space: nowrap;
  }
  .sub {
    margin-bottom: 2px;
  }
  .ruler {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    margin-top: 0.4rem;
  }
  .cell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1.2rem;
    height: 1.5rem;
    margin-right: -1px;
    border: 1px solid var(--tile-border);
    background: var(--tile);
    color: var(--text);
    font-size: 0.7rem;
    font-weight: 500;
  }
  .ruler-cell {
    border-color: transparent;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.6rem;
    height: 1rem;
    overflow: visible;
  }
  .sub .cell.gen {
    position: relative;
    background: var(--accent-soft);
    border-color: var(--accent-line);
    color: var(--accent-strong);
  }
  .cell.dim {
    background: transparent;
    border-color: transparent;
    color: var(--text-faint);
  }
  .cell.done {
    color: var(--text-faint);
  }
  .cell.fcs {
    position: relative;
    background: var(--accent-fill);
    border-color: var(--accent-fill);
    color: #ffffff;
  }
  /* The gap marks where the appended zeros (or the FCS) begin. */
  .cell.rule {
    margin-left: 0.75rem;
  }
  /* A lighter separator, purely for grouping bits into readable clusters. */
  .cell.gstart:not(.rule) {
    margin-left: 0.35rem;
  }
  tr.skipped {
    opacity: 0.5;
  }
</style>
