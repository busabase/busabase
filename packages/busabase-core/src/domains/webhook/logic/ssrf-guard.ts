import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// ── SSRF guard ───────────────────────────────────────────────────────────
//
// Shared by every place this domain performs outbound network I/O on behalf
// of a rule's configuration: `dispatch.ts`'s `performHttpDelivery` (the
// `webhook` / `notify_agent` signed POST) AND `sandbox.ts`'s bridged `fetch`
// (a `run_function` rule's sandboxed code calling out directly). Runs before
// EVERY attempt rather than being duplicated at each call site. Without it, a
// rule's `targetUrl` — validated only as `z.string().url()` at the contract
// layer, which enforces syntax, not destination — lets any actor with API
// access (any space member in the multi-tenant deployment) point delivery at
// cloud metadata (169.254.169.254), localhost, or an internal RFC1918 host,
// then read the response back via the persisted delivery log (or, for
// `run_function`, via its own captured logs/return value). Blocked:
//   - non-http(s) schemes
//   - loopback: 127.0.0.0/8, ::1, "localhost" / "*.localhost"
//   - link-local: 169.254.0.0/16 (covers the AWS/GCP/Azure metadata IP
//     169.254.169.254), IPv6 fe80::/10
//   - RFC1918 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
//   - IPv6 unique-local fc00::/7
//   - the unspecified addresses 0.0.0.0 / "::"
//   - IPv4-mapped/-compatible IPv6 forms of any of the above (e.g.
//     ::ffff:169.254.169.254) — a naive string check on the IPv6 form alone
//     would miss the embedded IPv4 metadata address

const isIPv4InBlockedRange = (ip: string): boolean => {
  const octets = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (
    octets.length !== 4 ||
    octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [a, b, c, d] = octets;
  if (a === 0 && b === 0 && c === 0 && d === 0) return true; // 0.0.0.0
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
};

/**
 * Expands any textual IPv6 form (with or without "::" abbreviation, with or
 * without a trailing embedded IPv4 literal like "::ffff:169.254.169.254")
 * into its 8 16-bit groups, or `null` if it isn't parseable. Used instead of
 * a string-prefix check so range membership (`fe80::/10`, `fc00::/7`, ...)
 * is computed correctly instead of guessed from formatting.
 */
const expandIPv6ToGroups = (ipInput: string): number[] | null => {
  let addr = ipInput.split("%")[0]; // strip a zone id, e.g. "fe80::1%eth0"

  let embeddedIPv4Groups: [number, number] | null = null;
  const ipv4Suffix = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4Suffix) {
    const octets = ipv4Suffix[1].split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
    embeddedIPv4Groups = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    addr = addr.slice(0, addr.length - ipv4Suffix[1].length).replace(/:$/, "");
  }

  let head: string[];
  let tail: string[];
  if (addr.includes("::")) {
    const segments = addr.split("::");
    if (segments.length > 2) return null; // more than one "::" is malformed
    head = segments[0] ? segments[0].split(":") : [];
    tail = segments[1] ? segments[1].split(":") : [];
    const fixedCount = head.length + tail.length + (embeddedIPv4Groups ? 2 : 0);
    const missing = 8 - fixedCount;
    if (missing < 0) return null;
    head = [...head, ...Array(missing).fill("0")];
  } else {
    head = addr ? addr.split(":") : [];
    tail = [];
    const fixedCount = head.length + (embeddedIPv4Groups ? 2 : 0);
    if (fixedCount !== 8) return null;
  }

  const groups = [...head, ...tail].map((part) => Number.parseInt(part, 16));
  if (embeddedIPv4Groups) groups.push(...embeddedIPv4Groups);
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff))
    return null;
  return groups;
};

const ipv6GroupsToBigInt = (groups: number[]): bigint =>
  groups.reduce((acc, group) => (acc << 16n) | BigInt(group), 0n);

/** Whether `addr` falls within `prefixGroups`'s top `prefixLen` bits. */
const ipv6InRange = (addr: bigint, prefixGroups: number[], prefixLen: number): boolean => {
  const prefixValue = ipv6GroupsToBigInt(prefixGroups);
  const hostBits = 128n - BigInt(prefixLen);
  const mask = ((1n << BigInt(prefixLen)) - 1n) << hostBits;
  return (addr & mask) === (prefixValue & mask);
};

const isIPv6InBlockedRange = (ip: string): boolean => {
  const groups = expandIPv6ToGroups(ip);
  // Shouldn't happen — `ip` only reaches here after `net.isIP` already
  // confirmed it's a valid IPv6 literal — but fail closed if it somehow does.
  if (!groups) return true;

  const addr = ipv6GroupsToBigInt(groups);
  if (addr === 0n) return true; // ::  (unspecified)
  if (addr === 1n) return true; // ::1 (loopback)
  if (ipv6InRange(addr, [0xfe80, 0, 0, 0, 0, 0, 0, 0], 10)) return true; // fe80::/10 link-local
  if (ipv6InRange(addr, [0xfc00, 0, 0, 0, 0, 0, 0, 0], 7)) return true; // fc00::/7 unique-local

  // IPv4-mapped (::ffff:a.b.c.d) / IPv4-compatible (::a.b.c.d) forms — check
  // the embedded IPv4 address too, since e.g. ::ffff:169.254.169.254 numerically
  // falls outside every pure-IPv6 range checked above.
  const isEmbeddedIPv4 =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    (groups[5] === 0 || groups[5] === 0xffff);
  if (isEmbeddedIPv4) {
    const embedded = `${(groups[6] >> 8) & 0xff}.${groups[6] & 0xff}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`;
    if (isIPv4InBlockedRange(embedded)) return true;
  }

  return false;
};

/** Takes a literal IP string (v4 or v6) and returns whether it's in a blocked range. */
export const isBlockedAddress = (ip: string): boolean => {
  const family = isIP(ip);
  if (family === 4) return isIPv4InBlockedRange(ip);
  if (family === 6) return isIPv6InBlockedRange(ip);
  return false; // not a literal IP at all — caller shouldn't reach here
};

/**
 * Resolves `hostname` via DNS and range-checks EVERY returned address —
 * closes the "attacker registers a hostname that resolves to an internal
 * IP" gap that a literal-IP-only check would miss. If resolution itself
 * fails (typo'd host, transient DNS blip, ...) that's not an SSRF signal —
 * report not-blocked and let `fetch()`'s own resolution + the existing
 * retry/error handling deal with it exactly as before this guard existed.
 */
export const resolveAndCheckHost = async (
  hostname: string,
): Promise<{ blocked: boolean; reason?: string }> => {
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return { blocked: false };
  }
  const blockedHit = addresses.find(({ address }) => isBlockedAddress(address));
  if (blockedHit) {
    return {
      blocked: true,
      reason: `host resolves to a private/internal address (${blockedHit.address})`,
    };
  }
  return { blocked: false };
};

/**
 * Test-only escape hatch for the webhook test suite's own local HTTP
 * listener(s), which — like every real SSRF target this guard exists to
 * block — are bound to 127.0.0.1. NEVER settable via rule config or any
 * other user input: only test code (see webhook-orpc.test.ts) sets this env
 * var, and it's only honored when Vitest itself has set `VITEST` (real
 * runtime code paths never set that), so it can't leak into production even
 * if the env var were somehow present there. Exact "host:port" match only —
 * not a blanket bypass — so an SSRF test in the very same run that targets a
 * DIFFERENT 127.0.0.1 port is still correctly blocked.
 */
const isTestAllowlistedTarget = (hostname: string, port: string): boolean => {
  if (!process.env.VITEST) return false;
  const allowlist = process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS;
  if (!allowlist) return false;
  return allowlist
    .split(",")
    .map((entry) => entry.trim())
    .includes(`${hostname}:${port}`);
};

/**
 * The guard itself — parses `urlString` and rejects it (with a human
 * readable `reason`) unless it's a plain http(s) URL pointing somewhere
 * outside the blocked ranges documented above. Called before EVERY delivery
 * attempt by `performHttpDelivery` (not just once outside its retry loop),
 * and before every `fetch()` call the sandbox bridges out of a `run_function`
 * rule's code (see sandbox.ts): that narrows — though doesn't fully close —
 * a DNS-rebinding window where the resolved address changes between one
 * attempt's check and the next. Fully closing that would mean pinning the
 * checked IP for the actual socket connection (a custom `dns.lookup`/agent)
 * — out of scope for this pass; the resolve+range-check here is the
 * appropriate scope.
 */
export const checkUrlIsSafeToFetch = async (
  urlString: string,
): Promise<{ blocked: boolean; reason?: string }> => {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { blocked: true, reason: "target URL could not be parsed" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { blocked: true, reason: `scheme "${parsed.protocol}" is not allowed` };
  }

  const hostname = parsed.hostname;
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  if (isTestAllowlistedTarget(hostname, port)) {
    return { blocked: false };
  }

  const lowerHost = hostname.toLowerCase();
  if (lowerHost === "localhost" || lowerHost.endsWith(".localhost")) {
    return { blocked: true, reason: 'host is "localhost"' };
  }

  if (isIP(hostname) !== 0) {
    return isBlockedAddress(hostname)
      ? { blocked: true, reason: `address ${hostname} is a private/internal address` }
      : { blocked: false };
  }

  return resolveAndCheckHost(hostname);
};
