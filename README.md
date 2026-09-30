<img src="public/favicon.svg" width="64" height="64" alt="">

## Error Detection & Subnetting

A static, client-side teaching site for two chapters of a computer-networks course:
error detection (CRC, VRC, LRC, checksums) and IPv4 subnetting. Nothing is sent
anywhere — all arithmetic runs in the browser.

## Running

```bash
pnpm install
pnpm dev      # http://localhost:4321
pnpm test     # vitest, 213 tests over src/lib
pnpm build    # static output in dist/
```

## Layout

```
src/lib/          pure TypeScript, framework-free, fully unit-tested
  gf2.ts             polynomial arithmetic + polyDivideSteps (the shared core)
  crc.ts             generation / verification
  lfsr.ts            shift-register simulation
  lfsr-svg.ts        circuit layout + SVG rendering
  generator-matrix.ts  G, H, syndrome decoding
  vrclrc.ts          2D parity grid
  checksum.ts        RFC 1071 + modular sum
  errors.ts          error-pattern generation (seeded, reproducible)
  subnet.ts          IPv4 addressing, subdivision, VLSM
src/components/   Svelte 5 islands (runes)
  BitString, DivisionTable      bits as tiles, the long-division table
  PolynomialPicker              build g(x) by term, or type it as text / hex / binary
  AddressBar, AddressBinary     subnet map of a block, and an address as 32 bit tiles
src/layouts/      the page shell: chapter rail, page header, next-chapter link
src/styles/       global.css — design tokens and the shared building blocks
src/pages/        one Astro page per topic
```

## Look and feel

The interface is a lab instrument for bits: a dark chapter rail numbered 00–07, a cool paper
ground, and every bit drawn as its own tile so message, check bits and errors read the same
on every page.

- **Two accents with fixed meanings.** Cobalt marks check bits (FCS, parity, borrowed subnet
  bits) and schemes that *catch* an error. Vermilion marks corrupted bits and *misses*. The two
  differ in lightness as well as hue, and every verdict also carries a word and an icon, so
  colour is never the only signal.
- **Type.** Instrument Sans for text, Martian Mono for bits and numbers. Both are self-hosted
  through `@fontsource`, so the site still makes no external requests.
- **Dark mode** follows the system setting, with its own token set in `global.css`.
- **Shared building blocks** live in `src/styles/global.css` rather than in components:
  panels with a label strip (`.card` / `.card-title`), joined toggles (`.segmented`), verdict
  banners (`.banner-ok` / `.banner-bad`), number readouts (`.readout`), stat tiles with a bar
  (`.stats`), numbered steps (`.step-head`), and the dark `.instrument` panel used for the
  circuit, the lab scoreboard and the matrix self-check.

## Design note

The long-division table, the shift-register trace, and the generator matrix are three
renderings of one computation. `polyDivideSteps` returns its full intermediate trace
rather than just a remainder, and everything else consumes that. The test suite pins
the equivalence: `lfsrCrc(m, g) === crcGenerate(m, g).fcs` for every preset in both
architectures, and `encode(m, systematicG) === crcGenerate(m, g).codeword`.

## Which CRC is this

The textbook form: no initial value, no bit reflection, no final XOR. That keeps the
numbers identical to the division table and circuit shown beside them. Named real-world
variants (Ethernet's CRC-32, for instance) add those parameters, so their published
check values will not match this site's output for the same polynomial. The polynomial,
the division, and the detection guarantees are unchanged.

## What the demos are for

The calculators are the easy half. The point is the failure cases:

- **VRC + LRC** — four bits at the corners of a rectangle give every affected row and
  column an *even* number of errors, so all parity bits still agree. One click on
  `/vrc-lrc` or `/lab` builds exactly that pattern.
- **Checksum** — +1 on one word and −1 on another cancel in the sum, as does swapping two
  words. The
  *Compensating pair* button on `/checksum` demonstrates it.
- **CRC** — catches both of the above, and every burst up to r bits. `/lab` runs
  batches of random bursts so the escape rate can be compared against 2^−(r−1).

## Input and display conventions

- **Everything is shown in binary**, with hex and decimal alongside where useful. Subnets are
  shown twice: as a to-scale map of the parent block, and as 32 bit tiles split into parent
  prefix, borrowed bits and host bits.
- **Word/row widths are free parameters.** The checksum runs at any width from 2 to 32 bits;
  VRC/LRC rows can be any width, not just 7 or 8. Small widths are far easier to check by hand.
- **Short data is zero-padded on the right**, so the last word or row is always complete.
  Padding is shown dimmed and reported explicitly — it is never silently invented. Padding
  goes on the right so every real bit keeps its place value.
- **CRC offers two routes to the same codeword**: `m·G` with the generator matrix (the
  default) and classical long division. The page cross-checks one against the other and
  says so on screen.
