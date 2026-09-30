<script lang="ts">
  /**
   * A proportional map of a parent address block: one segment per allocated subnet, with any
   * uncovered range drawn as hatched free space. Segment widths are exact fractions of the
   * parent, so a /25 is visibly half of a /24 and a /30 is a sliver.
   *
   * Segments are buttons when `onselect` is given, so the bar doubles as a picker for the
   * binary view below it.
   *
   * Its styles are in global.css under "Address map", not here: see the note there.
   */
  import { formatAddress } from '../lib/subnet';
  import type { BarSegment } from './address-bar';

  interface Props {
    parentStart: number;
    parentSize: number;
    parentPrefix: number;
    segments: BarSegment[];
    selected?: string | null;
    onselect?: (key: string) => void;
    /** Alternate two tones instead of cycling four — reads better for many equal subnets. */
    alternate?: boolean;
  }

  let { parentStart, parentSize, parentPrefix, segments, selected = null, onselect, alternate = false }: Props =
    $props();

  // Measured width, so label and tick thresholds are in pixels rather than percentages.
  let width = $state(800);

  interface Piece {
    key: string;
    free: boolean;
    label: string;
    start: number;
    size: number;
    prefix: number | null;
    frac: number;
    tone: number;
  }

  const pieces = $derived.by((): Piece[] => {
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const out: Piece[] = [];
    let cursor = parentStart;
    const end = parentStart + parentSize;
    const tones = alternate ? 2 : 4;
    const toneOf = new Map([...segments].map((s, i) => [s.key, i % tones]));
    const pushFree = (from: number, to: number) => {
      if (to > from)
        out.push({ key: `free-${from}`, free: true, label: 'Free', start: from, size: to - from, prefix: null, frac: (to - from) / parentSize, tone: 0 });
    };
    for (const s of sorted) {
      pushFree(cursor, s.start);
      out.push({ ...s, free: false, frac: s.size / parentSize, tone: toneOf.get(s.key) ?? 0 });
      cursor = s.start + s.size;
    }
    pushFree(cursor, end);
    return out;
  });

  /** Short boundary labels: only the octets that change inside the parent block. */
  function shortAddr(value: number): string {
    const full = formatAddress(value);
    if (parentPrefix >= 24) return '.' + full.split('.')[3];
    if (parentPrefix >= 16) return '.' + full.split('.').slice(2).join('.');
    return full;
  }

  const ticks = $derived.by(() => {
    const out: Array<{ pct: number; text: string; end?: boolean }> = [];
    // Room for one label, in percent of the bar: wider for full dotted addresses.
    const gap = ((parentPrefix >= 16 ? 44 : 110) / Math.max(width, 1)) * 100;
    let last = -1;
    for (const p of pieces) {
      const pct = ((p.start - parentStart) / parentSize) * 100;
      if (last < 0 || pct - last >= gap) {
        out.push({ pct, text: shortAddr(p.start) });
        last = pct;
      }
    }
    if (100 - last >= gap) out.push({ pct: 100, text: shortAddr(parentStart + parentSize - 1), end: true });
    return out;
  });

  const summary = $derived(
    pieces
      .map((p) => (p.free ? `free ${formatAddress(p.start)}, ${p.size} addresses` : `${p.label} ${formatAddress(p.start)}/${p.prefix}`))
      .join('; '),
  );
</script>

<div class="addrbar" bind:clientWidth={width}>
  <div class="bar" role={onselect ? 'group' : 'img'} aria-label={`Address map: ${summary}`}>
    {#each pieces as p (p.key)}
      {#if p.free}
        <div class="seg free" style={`flex-grow:${p.size}`} title={`Free · ${formatAddress(p.start)} · ${p.size.toLocaleString()} addresses`}></div>
      {:else if onselect}
        <button
          type="button"
          class={`seg t${p.tone}`}
          class:sel={selected === p.key}
          style={`flex-grow:${p.size}`}
          aria-pressed={selected === p.key}
          title={`${p.label} · ${formatAddress(p.start)}/${p.prefix}`}
          onclick={() => onselect(p.key)}
        >
          {#if p.frac * width >= 72}<span class="name">{p.label}</span>{/if}
          {#if p.frac * width >= 34}<span class="pfx">/{p.prefix}</span>{/if}
          <span class="sr">{p.label} {formatAddress(p.start)}/{p.prefix}</span>
        </button>
      {:else}
        <div class={`seg t${p.tone}`} style={`flex-grow:${p.size}`} title={`${p.label} · ${formatAddress(p.start)}/${p.prefix}`}>
          {#if p.frac * width >= 72}<span class="name">{p.label}</span>{/if}
          {#if p.frac * width >= 34}<span class="pfx">/{p.prefix}</span>{/if}
        </div>
      {/if}
    {/each}
  </div>
  <div class="ticks" aria-hidden="true">
    {#each ticks as t}
      <span class="tick" class:end={t.end} style={`left:${t.pct}%`}>{t.text}</span>
    {/each}
  </div>
</div>
