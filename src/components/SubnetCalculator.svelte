<script lang="ts">
  import {
    parseAddress,
    formatAddress,
    describeSubnet,
    subdivide,
    vlsm,
    binarySplit,
    toBinary,
    usableHosts,
    type VlsmRequirement,
  } from '../lib/subnet';

  let tab = $state<'calculator' | 'split' | 'vlsm'>('calculator');

  /* ---------------- calculator ---------------- */
  let address = $state('192.168.10.0');
  let prefix = $state(24);

  const info = $derived.by(() => {
    try {
      return describeSubnet(parseAddress(address), prefix);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  });

  const subnet = $derived(info && !('error' in info) ? info : null);

  /* ---------------- split ---------------- */
  let sizeBy = $state<'hosts' | 'subnets'>('hosts');
  let hostsPerSubnet = $state(30);
  let subnetCount = $state(4);
  let allowP2P = $state(false);

  const split = $derived.by(() => {
    try {
      return subdivide({
        address: parseAddress(address),
        prefix,
        hostsPerSubnet: sizeBy === 'hosts' ? hostsPerSubnet : undefined,
        subnetCount: sizeBy === 'subnets' ? subnetCount : undefined,
        allowPointToPoint: allowP2P,
        limit: 64,
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  });

  const splitOk = $derived(split && !('error' in split) ? split : null);

  /* ---------------- vlsm ---------------- */
  let requirementsText = $state('Sales: 110\nEngineering: 50\nOps: 12\nWAN link: 2');

  const requirements = $derived.by((): VlsmRequirement[] | { error: string } => {
    const out: VlsmRequirement[] = [];
    for (const [i, line] of requirementsText.split('\n').entries()) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const m = trimmed.match(/^(.*?)\s*[:=]\s*(\d+)$/);
      if (!m) return { error: `Line ${i + 1}: expected "name: hosts", got "${trimmed}"` };
      const hosts = Number(m[2]);
      if (hosts < 1) return { error: `Line ${i + 1}: host count must be at least 1` };
      out.push({ label: m[1] || `Subnet ${out.length + 1}`, hosts });
    }
    if (out.length === 0) return { error: 'Add at least one requirement' };
    return out;
  });

  const plan = $derived.by(() => {
    if ('error' in requirements) return { error: requirements.error } as const;
    try {
      return vlsm(parseAddress(address), prefix, requirements, allowP2P);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  });

  const planOk = $derived(plan && !('error' in plan) ? plan : null);
</script>

<div class="card">
  <div class="card-title">Network</div>
  <div class="controls">
    <div class="field field-grow">
      <label for="sn-addr">Address</label>
      <input id="sn-addr" type="text" bind:value={address} spellcheck="false" />
    </div>
    <div class="field" style="max-width:130px">
      <label for="sn-prefix">Prefix /{prefix}</label>
      <input id="sn-prefix" type="number" min="0" max="32" bind:value={prefix} />
    </div>
    <div class="field">
      <label for="sn-p2p">
        <input id="sn-p2p" type="checkbox" bind:checked={allowP2P} /> Allow /31 and /32
      </label>
    </div>
  </div>
  {#if info && 'error' in info}
    <div class="error-box" style="margin-top:0.9rem">{info.error}</div>
  {/if}
</div>

<div class="tabs" role="tablist">
  <button role="tab" aria-selected={tab === 'calculator'} onclick={() => (tab = 'calculator')}>Calculator</button>
  <button role="tab" aria-selected={tab === 'split'} onclick={() => (tab = 'split')}>Split into subnets</button>
  <button role="tab" aria-selected={tab === 'vlsm'} onclick={() => (tab = 'vlsm')}>VLSM</button>
</div>

{#if tab === 'calculator' && subnet}
  <div class="card">
    <div class="card-title">{formatAddress(subnet.network)}/{subnet.prefix}</div>
    <div class="grid-2">
      <dl class="kv">
        <dt>Network</dt>
        <dd>{formatAddress(subnet.network)}</dd>
        <dt>Mask</dt>
        <dd>{formatAddress(subnet.mask)}</dd>
        <dt>Wildcard</dt>
        <dd>{formatAddress(subnet.wildcard)}</dd>
        <dt>Broadcast</dt>
        <dd>{subnet.hasNetworkBroadcast ? formatAddress(subnet.broadcast) : '— none —'}</dd>
      </dl>
      <dl class="kv">
        <dt>First host</dt>
        <dd>{subnet.firstHost !== null ? formatAddress(subnet.firstHost) : '—'}</dd>
        <dt>Last host</dt>
        <dd>{subnet.lastHost !== null ? formatAddress(subnet.lastHost) : '—'}</dd>
        <dt>Usable hosts</dt>
        <dd>{subnet.usableHosts.toLocaleString()}</dd>
        <dt>Total addresses</dt>
        <dd>{subnet.totalAddresses.toLocaleString()}</dd>
      </dl>
    </div>

    <dl class="kv" style="margin-top:1rem">
      <dt>Class</dt>
      <dd>{subnet.addressClass}</dd>
      <dt>Range</dt>
      <dd>{subnet.specialRange ?? 'Public'}</dd>
    </dl>

    {#if !subnet.hasNetworkBroadcast}
      <p class="note" style="margin-top:1rem">
        {#if subnet.prefix === 31}
          A /31 has no network or broadcast address — RFC 3021 allocates both addresses to the two
          ends of a point-to-point link. The usual 2<sup>h</sup> − 2 rule does not apply.
        {:else}
          A /32 is a single host route: one address, no network or broadcast pair.
        {/if}
      </p>
    {/if}

    <div class="card-title" style="margin-top:1.5rem">Binary</div>
    <div class="scroll-x">
      <table>
        <tbody>
          <tr>
            <td class="note">Address</td>
            <td class="mono">{toBinary(subnet.address)}</td>
          </tr>
          <tr>
            <td class="note">Mask</td>
            <td class="mono">{toBinary(subnet.mask)}</td>
          </tr>
          <tr>
            <td class="note">Network</td>
            <td class="mono">{toBinary(subnet.network)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="note" style="margin-top:0.7rem">
      The leftmost {subnet.prefix} bits are fixed by the prefix; the remaining {subnet.hostBits}
      identify the host.
    </p>
  </div>
{:else if tab === 'split'}
  <div class="card">
    <div class="card-title">Requirement</div>
    <div class="button-row">
      <button class={sizeBy === 'hosts' ? 'primary' : ''} onclick={() => (sizeBy = 'hosts')}>
        Size by hosts per subnet
      </button>
      <button class={sizeBy === 'subnets' ? 'primary' : ''} onclick={() => (sizeBy = 'subnets')}>
        Size by number of subnets
      </button>
    </div>
    <div class="controls" style="margin-top:1rem">
      {#if sizeBy === 'hosts'}
        <div class="field" style="max-width:220px">
          <label for="sn-hosts">Usable hosts needed per subnet</label>
          <input id="sn-hosts" type="number" min="1" bind:value={hostsPerSubnet} />
        </div>
      {:else}
        <div class="field" style="max-width:220px">
          <label for="sn-count">Subnets needed</label>
          <input id="sn-count" type="number" min="1" bind:value={subnetCount} />
        </div>
      {/if}
    </div>
  </div>

  {#if split && 'error' in split}
    <div class="error-box">{split.error}</div>
  {:else if splitOk}
    <div class="card">
      <div class="card-title">Derivation</div>
      <ol class="steps">
        {#each splitOk.explanation as line}<li>{line}</li>{/each}
      </ol>
    </div>

    <div class="card">
      <div class="card-title">
        Result — /{splitOk.newPrefix}, {splitOk.subnetCount.toLocaleString()} subnets of {splitOk.blockSize.toLocaleString()}
      </div>
      <div class="scroll-x">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th class="mono">Network</th>
              <th class="mono">First host</th>
              <th class="mono">Last host</th>
              <th class="mono">Broadcast</th>
              <th>Usable</th>
              <th class="mono">Borrowed bits</th>
            </tr>
          </thead>
          <tbody>
            {#each splitOk.subnets as s, i}
              {@const bin = binarySplit(s.network, splitOk.parent.prefix, splitOk.newPrefix)}
              <tr>
                <td>{i}</td>
                <td class="mono">{formatAddress(s.network)}/{s.prefix}</td>
                <td class="mono">{s.firstHost !== null ? formatAddress(s.firstHost) : '—'}</td>
                <td class="mono">{s.lastHost !== null ? formatAddress(s.lastHost) : '—'}</td>
                <td class="mono">{s.hasNetworkBroadcast ? formatAddress(s.broadcast) : '—'}</td>
                <td>{s.usableHosts.toLocaleString()}</td>
                <td class="mono borrowed">{bin.subnet || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if splitOk.truncated}
        <p class="note">
          Showing the first {splitOk.subnets.length} of {splitOk.subnetCount.toLocaleString()}.
        </p>
      {/if}
      <p class="note" style="margin-top:0.9rem">
        The "borrowed bits" column is the part of the address the split actually claimed — it counts
        0, 1, 2, … in binary, one value per subnet.
      </p>
    </div>
  {/if}
{:else if tab === 'vlsm'}
  <div class="card">
    <div class="card-title">Requirements</div>
    <div class="field">
      <label for="sn-reqs">One per line, as <code>name: hosts</code></label>
      <textarea id="sn-reqs" rows="6" bind:value={requirementsText} spellcheck="false"></textarea>
    </div>
  </div>

  {#if plan && 'error' in plan}
    <div class="error-box">{plan.error}</div>
  {:else if planOk}
    <div class="card">
      <div class="card-title">Allocation</div>
      <div class="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Subnet</th>
              <th>Needed</th>
              <th class="mono">Assigned</th>
              <th class="mono">Range</th>
              <th>Usable</th>
              <th>Spare</th>
            </tr>
          </thead>
          <tbody>
            {#each planOk.allocations as a}
              <tr>
                <td><strong>{a.label}</strong></td>
                <td>{a.requested}</td>
                <td class="mono">{formatAddress(a.info.network)}/{a.info.prefix}</td>
                <td class="mono">
                  {a.info.firstHost !== null ? formatAddress(a.info.firstHost) : '—'} –
                  {a.info.lastHost !== null ? formatAddress(a.info.lastHost) : '—'}
                </td>
                <td>{a.info.usableHosts}</td>
                <td>{a.wasted}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if planOk.free.length}
        <p class="note" style="margin-top:0.9rem">
          Free: {formatAddress(planOk.free[0].start)} – {formatAddress(planOk.free[0].end)}
          ({planOk.free[0].size.toLocaleString()} addresses).
        </p>
      {:else}
        <p class="note" style="margin-top:0.9rem">The parent block is fully allocated.</p>
      {/if}
    </div>

    <div class="card">
      <div class="card-title">Why largest-first</div>
      <ol class="steps">
        {#each planOk.explanation as line}<li>{line}</li>{/each}
      </ol>
    </div>
  {/if}
{/if}

<div class="card">
  <div class="card-title">The general rule</div>
  <p class="note">
    The answer depends on the requirement, so the procedure — not any single worked number — is what
    to remember:
  </p>
  <ol class="steps">
    <li>
      Start from the parent prefix <code>/p</code>. Host bits available: <code>h = 32 − p</code>.
    </li>
    <li>
      Decide how many bits to borrow. Sized by <strong>hosts</strong> (H): you need
      <code>2^hostBits − 2 ≥ H</code>, so <code>hostBits = ⌈log₂(H + 2)⌉</code> and the new prefix is
      <code>/(32 − hostBits)</code>. Sized by <strong>subnet count</strong> (S): borrow
      <code>s = ⌈log₂ S⌉</code> bits, giving <code>/(p + s)</code>. If both are specified, the
      stricter — the longer prefix — wins.
    </li>
    <li>
      Check feasibility: the new prefix must satisfy <code>p ≤ newPrefix ≤ 32</code>. If not, the
      parent block simply cannot meet the requirement.
    </li>
    <li>
      Block size is <code>2^(32 − newPrefix)</code> addresses; in dotted notation the step in the
      interesting octet is <code>256 − maskOctet</code>.
    </li>
    <li>Enumerate subnets from the parent network address, stepping one block size at a time.</li>
    <li>
      Per subnet: network = first address, broadcast = last, everything between is usable —
      <code>2^(32 − newPrefix) − 2</code> of them.
    </li>
  </ol>
  <p class="note" style="margin-top:0.9rem">
    Two exceptions to that final <code>− 2</code>, and they are the usual exam trap:
    <strong>/31</strong> has no network/broadcast pair and gives 2 usable addresses for
    point-to-point links (RFC 3021), and <strong>/32</strong> is a single host route with 1 address.
  </p>
</div>

<style>
  textarea {
    font-family: var(--mono);
    resize: vertical;
  }
  .borrowed {
    color: var(--accent);
    font-weight: 700;
    letter-spacing: 0.1em;
  }
</style>
