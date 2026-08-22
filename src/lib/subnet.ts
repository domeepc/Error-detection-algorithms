/**
 * IPv4 addressing and subnetting.
 *
 * Addresses are held as unsigned 32-bit integers; dotted-quad is a display format only.
 * Every bitwise expression ends in `>>> 0` because JavaScript's bitwise operators produce
 * *signed* 32-bit results — without it, anything from 128.0.0.0 up comes back negative.
 *
 * The general sizing rule is implemented in `prefixForHosts` / `prefixForSubnets` and
 * documented on those functions; `subdivide` and `vlsm` are the two ways of applying it.
 */

export const IPV4_BITS = 32;

/* ------------------------------------------------------------------ *
 * Parsing and formatting
 * ------------------------------------------------------------------ */

export function parseAddress(input: string): number {
  const text = input.trim();
  const parts = text.split('.');
  if (parts.length !== 4) {
    throw new Error(`"${input}" is not a dotted-quad IPv4 address (expected 4 octets, got ${parts.length})`);
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) throw new Error(`"${part}" is not a valid octet in "${input}"`);
    const n = Number(part);
    if (n > 255) throw new Error(`Octet ${n} is out of range in "${input}" (0-255)`);
    value = ((value << 8) | n) >>> 0;
  }
  return value >>> 0;
}

export function formatAddress(value: number): string {
  const v = value >>> 0;
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff].join('.');
}

export interface Cidr {
  address: number;
  prefix: number;
}

/** Parse "192.168.1.10/24"; the prefix may also be supplied separately. */
export function parseCidr(input: string): Cidr {
  const text = input.trim();
  const slash = text.indexOf('/');
  if (slash === -1) throw new Error(`"${input}" is missing a /prefix`);
  const address = parseAddress(text.slice(0, slash));
  const prefixText = text.slice(slash + 1).trim();
  if (!/^\d{1,2}$/.test(prefixText)) throw new Error(`"${prefixText}" is not a valid prefix length`);
  const prefix = Number(prefixText);
  assertPrefix(prefix);
  return { address, prefix };
}

export function assertPrefix(prefix: number): void {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > IPV4_BITS) {
    throw new Error(`Prefix /${prefix} is out of range (must be 0-32)`);
  }
}

/** Mask with the top `prefix` bits set. `prefix === 0` must be special-cased: `<<32` is a no-op in JS. */
export function maskOf(prefix: number): number {
  assertPrefix(prefix);
  return prefix === 0 ? 0 : (0xffffffff << (IPV4_BITS - prefix)) >>> 0;
}

export function wildcardOf(prefix: number): number {
  return (~maskOf(prefix)) >>> 0;
}

export function networkOf(address: number, prefix: number): number {
  return (address & maskOf(prefix)) >>> 0;
}

export function broadcastOf(address: number, prefix: number): number {
  return (networkOf(address, prefix) | wildcardOf(prefix)) >>> 0;
}

/** Total addresses in the block. Uses Math.pow, not `1 << n`, so /0 gives 2^32 rather than 1. */
export function blockSize(prefix: number): number {
  assertPrefix(prefix);
  return Math.pow(2, IPV4_BITS - prefix);
}

/**
 * Usable host addresses.
 *
 * The familiar "2^h − 2" subtracts the network and broadcast addresses, but two prefixes
 * are exceptions and are the standard exam trap:
 *   /31  RFC 3021 point-to-point — no network/broadcast pair, both addresses usable.
 *   /32  a single host route — one address, itself.
 */
export function usableHosts(prefix: number): number {
  assertPrefix(prefix);
  if (prefix === IPV4_BITS) return 1;
  if (prefix === IPV4_BITS - 1) return 2;
  return blockSize(prefix) - 2;
}

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

export type AddressClass = 'A' | 'B' | 'C' | 'D (multicast)' | 'E (reserved)';

/** Legacy classful bucket — informational only; routing has been classless since CIDR (1993). */
export function addressClass(address: number): AddressClass {
  const first = (address >>> 24) & 0xff;
  if (first < 128) return 'A';
  if (first < 192) return 'B';
  if (first < 224) return 'C';
  if (first < 240) return 'D (multicast)';
  return 'E (reserved)';
}

const SPECIAL_RANGES: Array<{ cidr: string; label: string }> = [
  { cidr: '10.0.0.0/8', label: 'Private (RFC 1918)' },
  { cidr: '172.16.0.0/12', label: 'Private (RFC 1918)' },
  { cidr: '192.168.0.0/16', label: 'Private (RFC 1918)' },
  { cidr: '127.0.0.0/8', label: 'Loopback' },
  { cidr: '169.254.0.0/16', label: 'Link-local (APIPA)' },
  { cidr: '100.64.0.0/10', label: 'Carrier-grade NAT (RFC 6598)' },
  { cidr: '224.0.0.0/4', label: 'Multicast' },
  { cidr: '240.0.0.0/4', label: 'Reserved' },
  { cidr: '0.0.0.0/8', label: 'This network' },
];

export function specialRange(address: number): string | null {
  for (const { cidr, label } of SPECIAL_RANGES) {
    const { address: base, prefix } = parseCidr(cidr);
    if (networkOf(address, prefix) === networkOf(base, prefix)) return label;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Full calculator result
 * ------------------------------------------------------------------ */

export interface SubnetInfo {
  address: number;
  prefix: number;
  mask: number;
  wildcard: number;
  network: number;
  broadcast: number;
  /** null for /32, where there is no distinct usable range. */
  firstHost: number | null;
  lastHost: number | null;
  totalAddresses: number;
  usableHosts: number;
  hostBits: number;
  addressClass: AddressClass;
  specialRange: string | null;
  /** True when /31 or /32 suppresses the network/broadcast pair. */
  hasNetworkBroadcast: boolean;
}

export function describeSubnet(address: number, prefix: number): SubnetInfo {
  assertPrefix(prefix);
  const network = networkOf(address, prefix);
  const broadcast = broadcastOf(address, prefix);
  const hasNetworkBroadcast = prefix <= IPV4_BITS - 2;

  let firstHost: number | null;
  let lastHost: number | null;
  if (prefix === IPV4_BITS) {
    firstHost = network;
    lastHost = network;
  } else if (prefix === IPV4_BITS - 1) {
    firstHost = network;
    lastHost = broadcast;
  } else {
    firstHost = (network + 1) >>> 0;
    lastHost = (broadcast - 1) >>> 0;
  }

  return {
    address: address >>> 0,
    prefix,
    mask: maskOf(prefix),
    wildcard: wildcardOf(prefix),
    network,
    broadcast,
    firstHost,
    lastHost,
    totalAddresses: blockSize(prefix),
    usableHosts: usableHosts(prefix),
    hostBits: IPV4_BITS - prefix,
    addressClass: addressClass(address),
    specialRange: specialRange(address),
    hasNetworkBroadcast,
  };
}

/* ------------------------------------------------------------------ *
 * The general sizing rule
 * ------------------------------------------------------------------ */

/**
 * Smallest prefix (largest block) that still leaves room for `hosts` usable addresses.
 *
 * Solve 2^hostBits − 2 ≥ H for hostBits, i.e. hostBits = ceil(log2(H + 2)),
 * then prefix = 32 − hostBits. The +2 is the network and broadcast addresses.
 *
 * `allowPointToPoint` opts into the /31 and /32 special cases for H = 2 and H = 1.
 */
export function prefixForHosts(hosts: number, allowPointToPoint = false): number {
  if (!Number.isInteger(hosts) || hosts < 1) {
    throw new Error(`Host requirement must be a positive integer, got ${hosts}`);
  }
  if (allowPointToPoint) {
    if (hosts === 1) return 32;
    if (hosts === 2) return 31;
  }
  const hostBits = Math.ceil(Math.log2(hosts + 2));
  const prefix = IPV4_BITS - hostBits;
  if (prefix < 0) {
    throw new Error(`${hosts} hosts cannot be addressed in IPv4 (needs ${hostBits} host bits, only 32 available)`);
  }
  return prefix;
}

/**
 * Bits to borrow so that a parent block yields at least `count` equal subnets:
 * s = ceil(log2(count)), new prefix = parent + s.
 */
export function prefixForSubnets(parentPrefix: number, count: number): number {
  assertPrefix(parentPrefix);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Subnet count must be a positive integer, got ${count}`);
  }
  const borrowed = Math.ceil(Math.log2(count));
  const prefix = parentPrefix + borrowed;
  if (prefix > IPV4_BITS) {
    throw new Error(
      `Cannot split /${parentPrefix} into ${count} subnets: that needs ${borrowed} borrowed bits ` +
        `(/${prefix}), but only ${IPV4_BITS - parentPrefix} bits are available.`,
    );
  }
  return prefix;
}

export interface SubdivideRequest {
  address: number;
  prefix: number;
  /** Size by hosts-per-subnet, by subnet count, or both (the stricter wins). */
  hostsPerSubnet?: number;
  subnetCount?: number;
  allowPointToPoint?: boolean;
  /** Cap on how many subnets to enumerate, so /8 -> /30 does not build 4 million rows. */
  limit?: number;
}

export interface SubdivideResult {
  parent: SubnetInfo;
  newPrefix: number;
  borrowedBits: number;
  blockSize: number;
  /** Number of subnets the split actually produces. */
  subnetCount: number;
  /** Enumerated subnets, truncated to `limit`. */
  subnets: SubnetInfo[];
  truncated: boolean;
  /** Step-by-step derivation, for display. */
  explanation: string[];
}

/**
 * Apply the general rule to a parent block.
 *
 * Steps 1-6 of the rule are mirrored in the `explanation` array so the UI can show the
 * reasoning rather than just the answer.
 */
export function subdivide(req: SubdivideRequest): SubdivideResult {
  const { address, prefix, hostsPerSubnet, subnetCount, allowPointToPoint = false } = req;
  assertPrefix(prefix);
  if (hostsPerSubnet === undefined && subnetCount === undefined) {
    throw new Error('Specify hostsPerSubnet, subnetCount, or both');
  }

  const parent = describeSubnet(networkOf(address, prefix), prefix);
  const explanation: string[] = [
    `Parent block ${formatAddress(parent.network)}/${prefix} has ${IPV4_BITS - prefix} host bits ` +
      `(${parent.totalAddresses.toLocaleString()} addresses).`,
  ];

  const candidates: Array<{ prefix: number; source: 'hosts' | 'subnets' }> = [];

  if (hostsPerSubnet !== undefined) {
    const p = prefixForHosts(hostsPerSubnet, allowPointToPoint);
    const hostBits = IPV4_BITS - p;
    explanation.push(
      `Sized by hosts: need ${hostsPerSubnet} usable, so 2^h − 2 ≥ ${hostsPerSubnet} ` +
        `gives h = ⌈log₂(${hostsPerSubnet} + 2)⌉ = ${hostBits} host bits → /${p}.`,
    );
    candidates.push({ prefix: p, source: 'hosts' });
  }

  if (subnetCount !== undefined) {
    const p = prefixForSubnets(prefix, subnetCount);
    explanation.push(
      `Sized by subnet count: need ${subnetCount}, so borrow s = ⌈log₂ ${subnetCount}⌉ = ` +
        `${p - prefix} bits → /${p}.`,
    );
    candidates.push({ prefix: p, source: 'subnets' });
  }

  // The stricter constraint is the longer prefix: it yields smaller blocks, so it
  // satisfies both the host requirement and the subnet-count requirement.
  const newPrefix = Math.max(...candidates.map((c) => c.prefix));
  const winners = candidates.filter((c) => c.prefix === newPrefix);
  const drivenBy: 'hosts' | 'subnets' | 'both' =
    winners.length === 2 ? 'both' : winners[0].source;

  if (newPrefix < prefix) {
    throw new Error(
      `The requirement needs a /${newPrefix}, which is larger than the parent /${prefix}. ` +
        `Widen the parent block or lower the requirement.`,
    );
  }
  if (newPrefix > IPV4_BITS) {
    throw new Error(`Derived prefix /${newPrefix} exceeds /32.`);
  }

  const borrowedBits = newPrefix - prefix;
  const size = blockSize(newPrefix);
  const count = Math.pow(2, borrowedBits);

  const choice =
    candidates.length === 1
      ? `That gives /${newPrefix}`
      : drivenBy === 'both'
        ? `Both constraints agree on /${newPrefix}`
        : `The ${drivenBy} constraint is stricter, so it wins → /${newPrefix}`;

  explanation.push(
    `${choice}: borrow ${borrowedBits} bit(s) from the host portion, giving ` +
      `${count.toLocaleString()} subnet(s).`,
    `Block size = 2^(32 − ${newPrefix}) = ${size.toLocaleString()} addresses; in dotted notation the ` +
      `step in the interesting octet is ${interestingOctetStep(newPrefix)}.`,
    `Each subnet: first address is the network, last is the broadcast, ` +
      `${usableHosts(newPrefix).toLocaleString()} usable in between.`,
  );

  const limit = req.limit ?? 256;
  const enumerated = Math.min(count, limit);
  const subnets: SubnetInfo[] = [];
  for (let i = 0; i < enumerated; i++) {
    // Multiply-then-modulo rather than shifting: block counts can exceed 2^31.
    const base = (parent.network + i * size) % Math.pow(2, IPV4_BITS);
    subnets.push(describeSubnet(base >>> 0, newPrefix));
  }

  return {
    parent,
    newPrefix,
    borrowedBits,
    blockSize: size,
    subnetCount: count,
    subnets,
    truncated: count > enumerated,
    explanation,
  };
}

/**
 * The step between consecutive subnets, expressed in the octet the prefix falls inside —
 * the "256 − mask octet" shortcut used for mental arithmetic.
 */
export function interestingOctetStep(prefix: number): string {
  assertPrefix(prefix);
  if (prefix === 0) return 'the whole address space';
  const octetIndex = Math.min(3, Math.floor((prefix - 1) / 8));
  const mask = maskOf(prefix);
  const octetValue = (mask >>> (24 - octetIndex * 8)) & 0xff;
  const step = 256 - octetValue;
  const names = ['1st', '2nd', '3rd', '4th'];
  return `${step} in the ${names[octetIndex]} octet`;
}

/* ------------------------------------------------------------------ *
 * VLSM
 * ------------------------------------------------------------------ */

export interface VlsmRequirement {
  label: string;
  hosts: number;
}

export interface VlsmAllocation {
  label: string;
  requested: number;
  info: SubnetInfo;
  /** Usable addresses allocated but not requested. */
  wasted: number;
}

export interface VlsmFreeBlock {
  start: number;
  end: number;
  size: number;
}

export interface VlsmResult {
  parent: SubnetInfo;
  allocations: VlsmAllocation[];
  free: VlsmFreeBlock[];
  explanation: string[];
}

/**
 * Variable Length Subnet Masking: pack differently-sized subnets into one parent block.
 *
 * Requirements are sorted largest-first. That ordering is not cosmetic — allocating a
 * large block after several small ones can leave the address space fragmented into pieces
 * that are individually big enough but not properly aligned, since every block must start
 * at a multiple of its own size. Largest-first keeps every subsequent boundary aligned.
 */
export function vlsm(
  address: number,
  prefix: number,
  requirements: VlsmRequirement[],
  allowPointToPoint = false,
): VlsmResult {
  assertPrefix(prefix);
  if (requirements.length === 0) throw new Error('Provide at least one requirement');

  const parent = describeSubnet(networkOf(address, prefix), prefix);
  const parentEnd = parent.broadcast;

  const sorted = [...requirements].sort((a, b) => b.hosts - a.hosts);
  const explanation: string[] = [
    `Sort requirements largest-first: ${sorted.map((r) => `${r.label} (${r.hosts})`).join(', ')}.`,
    `Each block must start at an address that is a multiple of its own size, so allocating ` +
      `the largest first keeps every later boundary aligned.`,
  ];

  const allocations: VlsmAllocation[] = [];
  let cursor = parent.network;

  for (const req of sorted) {
    const childPrefix = prefixForHosts(req.hosts, allowPointToPoint);
    if (childPrefix < prefix) {
      throw new Error(
        `"${req.label}" needs ${req.hosts} hosts (a /${childPrefix}), which is larger than the ` +
          `parent /${prefix}.`,
      );
    }
    const size = blockSize(childPrefix);
    // Round the cursor up to the next boundary that is a multiple of this block's size.
    const aligned = Math.ceil(cursor / size) * size;
    if (aligned + size - 1 > parentEnd) {
      throw new Error(
        `Ran out of space allocating "${req.label}" (${req.hosts} hosts, /${childPrefix}). ` +
          `${formatAddress(parent.network)}/${prefix} cannot hold all requirements.`,
      );
    }
    const info = describeSubnet(aligned >>> 0, childPrefix);
    allocations.push({
      label: req.label,
      requested: req.hosts,
      info,
      wasted: info.usableHosts - req.hosts,
    });
    explanation.push(
      `${req.label}: ${req.hosts} hosts → /${childPrefix} (${size} addresses) at ` +
        `${formatAddress(info.network)} — ${info.usableHosts} usable, ${info.usableHosts - req.hosts} spare.`,
    );
    cursor = aligned + size;
  }

  const free: VlsmFreeBlock[] = [];
  if (cursor <= parentEnd) {
    free.push({ start: cursor >>> 0, end: parentEnd, size: parentEnd - cursor + 1 });
  }

  return {
    parent,
    allocations,
    free,
    explanation,
  };
}

/* ------------------------------------------------------------------ *
 * Binary rendering
 * ------------------------------------------------------------------ */

export interface BinarySplit {
  /** Bits belonging to the parent network portion. */
  network: string;
  /** Bits borrowed from the host portion to form subnets. */
  subnet: string;
  /** Remaining host bits. */
  host: string;
}

export function toBinary(value: number, groupOctets = true): string {
  const bits = (value >>> 0).toString(2).padStart(IPV4_BITS, '0');
  if (!groupOctets) return bits;
  return bits.match(/.{8}/g)!.join('.');
}

/**
 * Split the address into network / borrowed-subnet / host portions — the visual that
 * makes "borrowing bits" concrete.
 */
export function binarySplit(value: number, parentPrefix: number, childPrefix: number): BinarySplit {
  assertPrefix(parentPrefix);
  assertPrefix(childPrefix);
  if (childPrefix < parentPrefix) throw new Error('Child prefix must be at least as long as the parent');
  const bits = (value >>> 0).toString(2).padStart(IPV4_BITS, '0');
  return {
    network: bits.slice(0, parentPrefix),
    subnet: bits.slice(parentPrefix, childPrefix),
    host: bits.slice(childPrefix),
  };
}
