<script lang="ts">
  /**
   * Renders a GF(2) polynomial as real markup — x<sup>16</sup> + x<sup>12</sup> + … — instead
   * of the literal-caret text `formatAlgebraic` produces for round-tripping through
   * `parsePolynomial`. This component is display-only; nothing here is ever parsed back.
   */
  import { normalize, terms, type Bits } from '../lib/gf2';

  interface Props {
    bits: Bits;
  }

  let { bits }: Props = $props();

  const exponents = $derived(terms(normalize(bits)));
</script>

<span class="poly">
  {#if exponents.length === 0}
    0
  {:else}
    {#each exponents as exp, i (exp)}
      {#if i > 0}<span class="plus"> + </span>{/if}
      {#if exp === 0}1{:else if exp === 1}x{:else}x<sup>{exp}</sup>{/if}
    {/each}
  {/if}
</span>

<style>
  .poly {
    font-family: var(--mono);
    white-space: nowrap;
  }
  .poly sup {
    font-size: 0.7em;
    line-height: 0;
  }
  .plus {
    color: var(--text-muted);
  }
</style>
