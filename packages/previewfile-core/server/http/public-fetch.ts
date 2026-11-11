/**
 * `fetch()` for addresses nobody vouched for — a URL someone typed, a link to a
 * third-party file — that refuses to reach anything but the public internet:
 * loopback, private networks, link-local (cloud metadata at 169.254.169.254),
 * carrier-grade NAT (Alibaba Cloud's metadata at 100.100.100.200) and the other
 * special-purpose ranges. Without it, a server that fetches user-supplied URLs
 * can be talked into fetching its own neighbours and handing back the result
 * (server-side request forgery).
 *
 * Every hop is checked the same way: the host is resolved once, every address
 * it resolves to must be public, and the connection goes to the address that
 * was checked (looking the name up again could return a different one — DNS
 * rebinding). Redirects are followed by hand so each target is checked too.
 */

import { promises as dns } from "node:dns";
import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable, Transform } from "node:stream";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT, incl. Alibaba Cloud metadata
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. AWS/GCP/Azure metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 23], // IETF protocol assignments, incl. Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4: embeds an arbitrary IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}
// IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) need no rule of their own:
// BlockList checks them against the IPv4 ranges above.

/** True for an IP address on the public internet, false for anything special-purpose. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

export type PublicFetchRefusal =
  | "unsupported-protocol"
  | "blocked-address"
  | "too-many-redirects"
  | "too-large";

/** Thrown when a request is refused before or while it is made. */
export class PublicFetchError extends Error {
  constructor(
    readonly reason: PublicFetchRefusal,
    message: string,
  ) {
    super(message);
    this.name = "PublicFetchError";
  }
}

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PublicFetchInit {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface PublicFetchOptions {
  /** Redirects followed before giving up (default 5). */
  maxRedirects?: number;
  /** Whole-request budget, body included (default 60s). */
  timeoutMs?: number;
  /** Refuse bodies larger than this many bytes, declared or streamed. */
  maxBytes?: number;
  /** Name resolution (default: every address `dns.lookup` returns). Test seam. */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Which addresses count as public (default `isPublicAddress`). Test seam. */
  isPublicAddress?: (address: string) => boolean;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal"];

const defaultLookup = async (hostname: string): Promise<ResolvedAddress[]> =>
  (await dns.lookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));

/** The one address to connect to for `url`, after checking every address its host has. */
async function resolvePublicTarget(
  url: URL,
  lookup: NonNullable<PublicFetchOptions["lookup"]>,
  isPublic: NonNullable<PublicFetchOptions["isPublicAddress"]>,
): Promise<ResolvedAddress> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PublicFetchError(
      "unsupported-protocol",
      `Only http and https are allowed, not ${url.protocol}`,
    );
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new PublicFetchError("blocked-address", `${hostname} is not a public host`);
  }

  const literal = isIP(hostname);
  const addresses: ResolvedAddress[] = literal
    ? [{ address: hostname, family: literal as 4 | 6 }]
    : await lookup(hostname);
  // All of them, not just the first: a host with one public and one private
  // address could be steered to the private one.
  const refused = addresses.find(({ address }) => !isPublic(address));
  if (addresses.length === 0 || refused) {
    // The refused address stays out of the message: it can reach the caller,
    // and an internal name's resolution is itself worth not disclosing.
    throw new PublicFetchError(
      "blocked-address",
      `${hostname} does not resolve to a public address`,
    );
  }
  return addresses[0] as ResolvedAddress;
}

function send(
  url: URL,
  target: ResolvedAddress,
  init: { method: string; headers?: Record<string, string>; signal: AbortSignal },
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: init.method,
        headers: init.headers,
        signal: init.signal,
        // Connect to the address that was checked — never a fresh lookup.
        lookup: ((
          _hostname: string,
          options: { all?: boolean },
          callback: (error: null, address: string | ResolvedAddress[], family?: number) => void,
        ) => {
          if (options?.all) callback(null, [{ address: target.address, family: target.family }]);
          else callback(null, target.address, target.family);
        }) as never,
      },
      resolve,
    );
    request.on("error", reject);
    request.end();
  });
}

function toHeaders(source: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  return headers;
}

function toResponse(message: IncomingMessage, method: string, maxBytes?: number): Response {
  const status = message.statusCode ?? 502;
  const declared = Number(message.headers["content-length"]);
  if (maxBytes !== undefined && Number.isFinite(declared) && declared > maxBytes) {
    message.destroy();
    throw new PublicFetchError(
      "too-large",
      `Response is ${declared} bytes, over the ${maxBytes} byte limit`,
    );
  }
  if (method === "HEAD" || NULL_BODY_STATUSES.has(status)) {
    message.resume();
    return new Response(null, {
      status,
      statusText: message.statusMessage,
      headers: toHeaders(message.headers),
    });
  }

  let body: Readable = message;
  if (maxBytes !== undefined) {
    let seen = 0;
    const cap = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        seen += chunk.length;
        if (seen > maxBytes) {
          callback(
            new PublicFetchError("too-large", `Response exceeds the ${maxBytes} byte limit`),
          );
        } else {
          callback(null, chunk);
        }
      },
    });
    message.on("error", (error) => cap.destroy(error));
    body = message.pipe(cap);
  }
  return new Response(Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>, {
    status,
    statusText: message.statusMessage,
    headers: toHeaders(message.headers),
  });
}

/**
 * Like `fetch(url, init)` for GET and HEAD, but only to the public internet.
 * Throws `PublicFetchError` when a hop is refused; HTTP error statuses are
 * returned as responses, as `fetch` does.
 */
export async function fetchPublicUrl(
  input: string | URL,
  init: PublicFetchInit = {},
  options: PublicFetchOptions = {},
): Promise<Response> {
  const lookup = options.lookup ?? defaultLookup;
  const isPublic = options.isPublicAddress ?? isPublicAddress;
  const maxRedirects = options.maxRedirects ?? 5;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  let url = new URL(input);
  let method = init.method ?? "GET";
  for (let redirects = 0; ; redirects++) {
    const target = await resolvePublicTarget(url, lookup, isPublic);
    const message = await send(url, target, { method, headers: init.headers, signal });
    const location = message.headers.location;
    if (!location || !REDIRECT_STATUSES.has(message.statusCode ?? 0)) {
      return toResponse(message, method, options.maxBytes);
    }
    message.resume();
    if (redirects >= maxRedirects) {
      throw new PublicFetchError("too-many-redirects", `More than ${maxRedirects} redirects`);
    }
    url = new URL(location, url);
    if (message.statusCode === 303 && method !== "HEAD") method = "GET";
  }
}
