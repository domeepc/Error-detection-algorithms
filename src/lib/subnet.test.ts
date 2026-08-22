import { describe, it, expect } from 'vitest';
import {
  parseAddress,
  formatAddress,
  parseCidr,
  maskOf,
  wildcardOf,
  blockSize,
  usableHosts,
  describeSubnet,
  prefixForHosts,
  prefixForSubnets,
  subdivide,
  vlsm,
  addressClass,
  specialRange,
  interestingOctetStep,
  toBinary,
  binarySplit,
} from './subnet';

describe('parsing and formatting', () => {
  it('round-trips dotted quads, including the high half of the space', () => {
    for (const ip of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '192.168.1.255', '255.255.255.255', '224.0.0.9']) {
      expect(formatAddress(parseAddress(ip))).toBe(ip);
    }
  });

  it('keeps high addresses unsigned', () => {
    // The classic bug: 128.0.0.0 comes back negative without >>> 0.
    expect(parseAddress('128.0.0.0')).toBeGreaterThan(0);
    expect(parseAddress('255.255.255.255')).toBe(4294967295);
  });

  it('rejects malformed input', () => {
    expect(() => parseAddress('1.2.3')).toThrow(/4 octets/);
    expect(() => parseAddress('1.2.3.256')).toThrow(/out of range/);
    expect(() => parseAddress('1.2.3.x')).toThrow(/valid octet/);
    expect(() => parseCidr('10.0.0.0')).toThrow(/missing a \/prefix/);
    expect(() => parseCidr('10.0.0.0/33')).toThrow(/out of range/);
  });

  it('parses CIDR', () => {
    const { address, prefix } = parseCidr('192.168.1.10/24');
    expect(formatAddress(address)).toBe('192.168.1.10');
    expect(prefix).toBe(24);
  });
});

describe('masks and block sizes', () => {
  it('builds masks, including the /0 edge case', () => {
    expect(formatAddress(maskOf(0))).toBe('0.0.0.0');
    expect(formatAddress(maskOf(24))).toBe('255.255.255.0');
    expect(formatAddress(maskOf(26))).toBe('255.255.255.192');
    expect(formatAddress(maskOf(32))).toBe('255.255.255.255');
  });

  it('builds wildcard masks', () => {
    expect(formatAddress(wildcardOf(24))).toBe('0.0.0.255');
    expect(formatAddress(wildcardOf(30))).toBe('0.0.0.3');
  });

  it('computes block sizes without 32-bit shift overflow', () => {
    expect(blockSize(0)).toBe(4294967296);
    expect(blockSize(24)).toBe(256);
    expect(blockSize(32)).toBe(1);
  });

  it('applies the /31 and /32 exceptions to the -2 rule', () => {
    expect(usableHosts(24)).toBe(254);
    expect(usableHosts(30)).toBe(2);
    expect(usableHosts(31)).toBe(2); // RFC 3021 point-to-point
    expect(usableHosts(32)).toBe(1); // host route
  });
});

describe('describeSubnet', () => {
  it('derives every field for a /26', () => {
    const info = describeSubnet(parseAddress('192.168.1.100'), 26);
    expect(formatAddress(info.network)).toBe('192.168.1.64');
    expect(formatAddress(info.broadcast)).toBe('192.168.1.127');
    expect(formatAddress(info.firstHost!)).toBe('192.168.1.65');
    expect(formatAddress(info.lastHost!)).toBe('192.168.1.126');
    expect(info.usableHosts).toBe(62);
    expect(info.hostBits).toBe(6);
    expect(info.specialRange).toBe('Private (RFC 1918)');
  });

  it('treats a /31 as two usable addresses with no broadcast', () => {
    const info = describeSubnet(parseAddress('10.0.0.4'), 31);
    expect(info.hasNetworkBroadcast).toBe(false);
    expect(formatAddress(info.firstHost!)).toBe('10.0.0.4');
    expect(formatAddress(info.lastHost!)).toBe('10.0.0.5');
    expect(info.usableHosts).toBe(2);
  });

  it('treats a /32 as a single host route', () => {
    const info = describeSubnet(parseAddress('10.0.0.7'), 32);
    expect(info.usableHosts).toBe(1);
    expect(formatAddress(info.firstHost!)).toBe('10.0.0.7');
    expect(formatAddress(info.lastHost!)).toBe('10.0.0.7');
  });

  it('classifies addresses', () => {
    expect(addressClass(parseAddress('10.0.0.1'))).toBe('A');
    expect(addressClass(parseAddress('172.16.0.1'))).toBe('B');
    expect(addressClass(parseAddress('192.168.0.1'))).toBe('C');
    expect(addressClass(parseAddress('224.0.0.1'))).toBe('D (multicast)');
    expect(addressClass(parseAddress('250.0.0.1'))).toBe('E (reserved)');
  });

  it('recognises special ranges', () => {
    expect(specialRange(parseAddress('10.1.2.3'))).toBe('Private (RFC 1918)');
    expect(specialRange(parseAddress('172.16.5.5'))).toBe('Private (RFC 1918)');
    expect(specialRange(parseAddress('172.32.5.5'))).toBeNull(); // outside the /12
    expect(specialRange(parseAddress('127.0.0.1'))).toBe('Loopback');
    expect(specialRange(parseAddress('169.254.1.1'))).toBe('Link-local (APIPA)');
    expect(specialRange(parseAddress('8.8.8.8'))).toBeNull();
  });
});

describe('the general sizing rule', () => {
  it('sizes by hosts: 2^h - 2 >= H', () => {
    expect(prefixForHosts(2)).toBe(30); // 4 - 2 = 2
    expect(prefixForHosts(6)).toBe(29);
    expect(prefixForHosts(14)).toBe(28);
    expect(prefixForHosts(30)).toBe(27);
    expect(prefixForHosts(50)).toBe(26); // 64 - 2 = 62 >= 50
    expect(prefixForHosts(62)).toBe(26);
    expect(prefixForHosts(63)).toBe(25); // 62 is not enough
    expect(prefixForHosts(254)).toBe(24);
  });

  it('opts into point-to-point prefixes only when asked', () => {
    expect(prefixForHosts(2)).toBe(30);
    expect(prefixForHosts(2, true)).toBe(31);
    expect(prefixForHosts(1, true)).toBe(32);
  });

  it('sizes by subnet count: borrow ceil(log2 S) bits', () => {
    expect(prefixForSubnets(24, 4)).toBe(26);
    expect(prefixForSubnets(24, 5)).toBe(27); // rounds up to 8 subnets
    expect(prefixForSubnets(8, 1000)).toBe(18); // 2^10 = 1024
  });

  it('reports infeasible requirements instead of guessing', () => {
    expect(() => prefixForSubnets(30, 8)).toThrow(/only 2 bits are available/);
    expect(() => prefixForHosts(0)).toThrow(/positive integer/);
  });

  it('computes the interesting-octet step', () => {
    expect(interestingOctetStep(26)).toBe('64 in the 4th octet');
    expect(interestingOctetStep(27)).toBe('32 in the 4th octet');
    expect(interestingOctetStep(18)).toBe('64 in the 3rd octet');
    expect(interestingOctetStep(12)).toBe('16 in the 2nd octet');
  });
});

describe('subdivide', () => {
  it('splits a /24 for 50 hosts per subnet', () => {
    const result = subdivide({ address: parseAddress('192.168.1.0'), prefix: 24, hostsPerSubnet: 50 });
    expect(result.newPrefix).toBe(26);
    expect(result.blockSize).toBe(64);
    expect(result.subnetCount).toBe(4);
    expect(result.subnets.map((s) => formatAddress(s.network))).toEqual([
      '192.168.1.0',
      '192.168.1.64',
      '192.168.1.128',
      '192.168.1.192',
    ]);
    expect(result.subnets[0].usableHosts).toBe(62);
    expect(result.explanation.join(' ')).toMatch(/hosts constraint is stricter|Sized by hosts/);
  });

  it('splits a /24 for 30 hosts per subnet', () => {
    const result = subdivide({ address: parseAddress('192.168.10.0'), prefix: 24, hostsPerSubnet: 30 });
    expect(result.newPrefix).toBe(27);
    expect(result.blockSize).toBe(32);
    expect(result.subnetCount).toBe(8);
    expect(result.subnets.every((s) => s.usableHosts === 30)).toBe(true);
  });

  it('splits a /8 into 1000 subnets', () => {
    const result = subdivide({
      address: parseAddress('10.0.0.0'),
      prefix: 8,
      subnetCount: 1000,
      limit: 4,
    });
    expect(result.newPrefix).toBe(18);
    expect(result.borrowedBits).toBe(10);
    expect(result.subnetCount).toBe(1024);
    expect(result.truncated).toBe(true);
    expect(result.subnets).toHaveLength(4);
    expect(formatAddress(result.subnets[1].network)).toBe('10.0.64.0');
  });

  it('takes the stricter of two constraints', () => {
    // 4 subnets alone wants /26; 12 hosts alone wants /28. /28 wins.
    const result = subdivide({
      address: parseAddress('192.168.1.0'),
      prefix: 24,
      subnetCount: 4,
      hostsPerSubnet: 12,
    });
    expect(result.newPrefix).toBe(28);
    expect(result.explanation.join(' ')).toMatch(/hosts constraint is stricter|Sized by hosts/);
  });

  it('reports when both constraints agree', () => {
    const result = subdivide({
      address: parseAddress('192.168.1.0'),
      prefix: 24,
      subnetCount: 4,
      hostsPerSubnet: 62,
    });
    expect(result.newPrefix).toBe(26);
    expect(result.explanation.join(' ')).toMatch(/Both constraints agree/);
  });

  it('refuses a requirement larger than the parent block', () => {
    expect(() =>
      subdivide({ address: parseAddress('192.168.1.0'), prefix: 24, hostsPerSubnet: 500 }),
    ).toThrow(/larger than the parent/);
  });

  it('requires at least one constraint', () => {
    expect(() => subdivide({ address: parseAddress('10.0.0.0'), prefix: 8 })).toThrow(/Specify/);
  });

  it('produces a readable derivation', () => {
    const { explanation } = subdivide({
      address: parseAddress('192.168.1.0'),
      prefix: 24,
      hostsPerSubnet: 50,
    });
    expect(explanation.join(' ')).toMatch(/log₂/);
    expect(explanation.join(' ')).toMatch(/64 in the 4th octet/);
    // With a single constraint there is nothing to be "stricter" than.
    expect(explanation.join(' ')).not.toMatch(/stricter/);
  });

  it('names which constraint won when two are given', () => {
    const strict = subdivide({
      address: parseAddress('192.168.1.0'),
      prefix: 24,
      subnetCount: 4,
      hostsPerSubnet: 12,
    });
    expect(strict.explanation.join(' ')).toMatch(/hosts constraint is stricter/);

    const tie = subdivide({
      address: parseAddress('192.168.1.0'),
      prefix: 24,
      subnetCount: 4,
      hostsPerSubnet: 62,
    });
    expect(tie.explanation.join(' ')).toMatch(/Both constraints agree/);
  });

  it('never emits overlapping subnets', () => {
    const result = subdivide({ address: parseAddress('172.16.0.0'), prefix: 16, hostsPerSubnet: 100 });
    for (let i = 1; i < result.subnets.length; i++) {
      expect(result.subnets[i].network).toBeGreaterThan(result.subnets[i - 1].broadcast);
    }
  });
});

describe('vlsm', () => {
  const parent = parseAddress('192.168.1.0');

  it('allocates largest-first without overlap', () => {
    const result = vlsm(parent, 24, [
      { label: 'Sales', hosts: 110 },
      { label: 'Eng', hosts: 50 },
      { label: 'Ops', hosts: 12 },
      { label: 'Link', hosts: 2 },
    ]);

    expect(result.allocations.map((a) => a.label)).toEqual(['Sales', 'Eng', 'Ops', 'Link']);
    expect(result.allocations.map((a) => `${formatAddress(a.info.network)}/${a.info.prefix}`)).toEqual([
      '192.168.1.0/25',
      '192.168.1.128/26',
      '192.168.1.192/28',
      '192.168.1.208/30',
    ]);

    for (let i = 1; i < result.allocations.length; i++) {
      expect(result.allocations[i].info.network).toBeGreaterThan(result.allocations[i - 1].info.broadcast);
    }
  });

  it('keeps every allocation inside the parent block', () => {
    const result = vlsm(parent, 24, [
      { label: 'A', hosts: 60 },
      { label: 'B', hosts: 28 },
      { label: 'C', hosts: 10 },
    ]);
    const p = result.parent;
    for (const a of result.allocations) {
      expect(a.info.network).toBeGreaterThanOrEqual(p.network);
      expect(a.info.broadcast).toBeLessThanOrEqual(p.broadcast);
    }
  });

  it('aligns every block to a multiple of its own size', () => {
    const result = vlsm(parseAddress('10.0.0.0'), 22, [
      { label: 'A', hosts: 500 },
      { label: 'B', hosts: 200 },
      { label: 'C', hosts: 100 },
      { label: 'D', hosts: 20 },
    ]);
    for (const a of result.allocations) {
      expect(a.info.network % a.info.totalAddresses).toBe(0);
    }
  });

  it('reports wasted addresses per allocation', () => {
    const result = vlsm(parent, 24, [{ label: 'Sales', hosts: 110 }]);
    // A /25 gives 126 usable for a request of 110.
    expect(result.allocations[0].wasted).toBe(16);
  });

  it('reports the leftover free block', () => {
    const result = vlsm(parent, 24, [{ label: 'Sales', hosts: 110 }]);
    expect(result.free).toHaveLength(1);
    expect(formatAddress(result.free[0].start)).toBe('192.168.1.128');
    expect(result.free[0].size).toBe(128);
  });

  it('fails clearly when the parent cannot hold everything', () => {
    expect(() =>
      vlsm(parent, 24, [
        { label: 'A', hosts: 120 },
        { label: 'B', hosts: 120 },
        { label: 'C', hosts: 120 },
      ]),
    ).toThrow(/Ran out of space/);
  });

  it('rejects a single requirement bigger than the parent', () => {
    expect(() => vlsm(parent, 24, [{ label: 'Huge', hosts: 5000 }])).toThrow(/larger than the parent/);
  });

  it('requires at least one requirement', () => {
    expect(() => vlsm(parent, 24, [])).toThrow(/at least one/);
  });
});

describe('binary rendering', () => {
  it('groups octets', () => {
    expect(toBinary(parseAddress('192.168.1.1'))).toBe('11000000.10101000.00000001.00000001');
  });

  it('splits network / borrowed / host portions', () => {
    const split = binarySplit(parseAddress('192.168.1.64'), 24, 26);
    expect(split.network).toHaveLength(24);
    expect(split.subnet).toBe('01');
    expect(split.host).toHaveLength(6);
  });

  it('rejects a child prefix shorter than the parent', () => {
    expect(() => binarySplit(0, 24, 16)).toThrow(/at least as long/);
  });
});
