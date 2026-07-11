import "server-only";

import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { BusabaseDatabase } from "../../../context";
import { id, now } from "../../../logic/kernel";
import { busabaseWebhookDeliveries } from "../schema/webhook-deliveries";
import {
  busabaseWebhookRules,
  type WebhookRuleConfigPO,
  type WebhookRuleHttpConfigPO,
  type WebhookRuleSnippetConfigPO,
} from "../schema/webhook-rules";
import type { WebhookDeliveryStatus, WebhookDeliveryVO, WebhookEventType } from "../types/webhook";
import { runSnippet } from "./sandbox";
import { decryptWebhookSecret } from "./webhook-crypto";
import { toWebhookDeliveryVO } from "./webhook-logic";

type WebhookRuleRow = typeof busabaseWebhookRules.$inferSelect;
type WebhookDeliveryRow = typeof busabaseWebhookDeliveries.$inferSelect;

// Delivery `detail` holds truncated response bodies / error messages /
// captured snippet console.log output — cap it to a few KB so a chatty
// endpoint or snippet can't bloat the deliveries table.
const DETAIL_MAX_CHARS = 4000;
const HTTP_DELIVERY_TIMEOUT_MS = 5000;

// A single flaky attempt (a cold-started receiver, a transient 5xx, a blip in
// network) shouldn't sink a whole rule's delivery — retry with backoff before
// giving up. Each attempt still gets its own HTTP_DELIVERY_TIMEOUT_MS; only
// the FINAL attempt's outcome is what gets persisted as the delivery record.
const HTTP_DELIVERY_MAX_ATTEMPTS = 3; // 1 initial attempt + 2 retries
// Backoff waited before retry #2 and retry #3, respectively (exponential).
const HTTP_DELIVERY_RETRY_DELAYS_MS = [250, 750];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// What a `run_snippet` rule's returned value must look like to be treated as
// "the snippet wants to make an HTTP call". Anything else (including no
// return value at all) means "just computed, didn't call anything".
const SnippetCallSpecSchema = z.object({
  url: z.string().url(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
});

const truncate = (value: string, max = DETAIL_MAX_CHARS): string =>
  value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;

interface DeliveryOutcome {
  status: WebhookDeliveryStatus;
  httpStatus: number | null;
  detail: string | null;
  durationMs: number | null;
}

// ── SSRF guard ───────────────────────────────────────────────────────────
//
// `performHttpDelivery` below is the single funnel point for every outbound
// fetch this domain makes (the `webhook`/`notify_agent` direct POST AND
// `run_snippet`'s sandbox-computed call spec), so this guard lives here and
// runs before EVERY attempt rather than being duplicated at each of the 3
// action-kind call sites in `dispatchOneRule`. Without it, a rule's
// `targetUrl` — validated only as `z.string().url()` at the contract layer,
// which enforces syntax, not destination — lets any actor with API access
// (any space member in the multi-tenant deployment) point delivery at cloud
// metadata (169.254.169.254), localhost, or an internal RFC1918 host, then
// read the response back via the persisted delivery log. Blocked:
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
 * attempt by `performHttpDelivery` (not just once outside its retry loop):
 * that narrows — though doesn't fully close — a DNS-rebinding window where
 * the resolved address changes between one attempt's check and the next.
 * Fully closing that would mean pinning the checked IP for the actual
 * socket connection (a custom `dns.lookup`/agent) — out of scope for this
 * pass; the resolve+range-check here is the appropriate scope.
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

/**
 * The ONLY place network I/O happens for webhook dispatch — used both by the
 * direct `webhook` / `notify_agent` action and by a `run_snippet` action's
 * computed call spec (the sandbox itself never touches the network). Signs
 * the body with the rule's decrypted secret, when present, as
 * `X-Busabase-Signature` (HMAC-SHA256 hex over the raw body).
 *
 * Retries a failed attempt (thrown error, timeout, or non-2xx response) with
 * exponential backoff, up to HTTP_DELIVERY_MAX_ATTEMPTS total attempts — a
 * single flaky attempt must not sink the whole delivery. Every one of the
 * three action-kind paths in `dispatchOneRule` funnels through here, so all
 * of them get retries automatically. Only the LAST attempt's outcome is
 * returned/persisted; its `detail` notes how many attempts were made when the
 * final outcome is a failure, so the delivery log stays debuggable.
 *
 * Before every attempt, `checkUrlIsSafeToFetch` re-validates `args.url` isn't
 * pointing at a blocked (loopback/link-local/private/metadata) address — see
 * the "SSRF guard" section above. A blocked target fails IMMEDIATELY (no
 * fetch attempted, no backoff sleep, no burning the remaining retries) since
 * it's a config problem, not a flaky network blip.
 */
const performHttpDelivery = async (args: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  secret?: string;
  body: string;
}): Promise<DeliveryOutcome> => {
  const overallStartedAt = Date.now();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...args.headers,
  };
  if (args.secret) {
    headers["X-Busabase-Signature"] = createHmac("sha256", args.secret)
      .update(args.body)
      .digest("hex");
  }

  let outcome: DeliveryOutcome = {
    status: "failed",
    httpStatus: null,
    detail: null,
    durationMs: null,
  };

  for (let attempt = 1; attempt <= HTTP_DELIVERY_MAX_ATTEMPTS; attempt++) {
    const safety = await checkUrlIsSafeToFetch(args.url);
    if (safety.blocked) {
      return {
        status: "failed",
        httpStatus: null,
        detail: truncate(`Blocked: target ${safety.reason ?? "is not allowed"} (SSRF protection)`),
        durationMs: Date.now() - overallStartedAt,
      };
    }

    try {
      const response = await fetch(args.url, {
        method: args.method ?? "POST",
        headers,
        body: args.body,
        signal: AbortSignal.timeout(HTTP_DELIVERY_TIMEOUT_MS),
      });
      const durationMs = Date.now() - overallStartedAt;
      if (response.ok) {
        return { status: "success", httpStatus: response.status, detail: null, durationMs };
      }
      const bodyText = await response.text().catch(() => "");
      outcome = {
        status: "failed",
        httpStatus: response.status,
        detail: truncate(bodyText || `HTTP ${response.status}`),
        durationMs,
      };
    } catch (error) {
      outcome = {
        status: "failed",
        httpStatus: null,
        detail: truncate(error instanceof Error ? error.message : String(error)),
        durationMs: Date.now() - overallStartedAt,
      };
    }

    const isLastAttempt = attempt === HTTP_DELIVERY_MAX_ATTEMPTS;
    if (isLastAttempt) break;
    await sleep(HTTP_DELIVERY_RETRY_DELAYS_MS[attempt - 1]);
  }

  // Every attempt failed — note the attempt count without bloating `detail`
  // beyond the existing DETAIL_MAX_CHARS cap.
  if (HTTP_DELIVERY_MAX_ATTEMPTS > 1) {
    const attemptsNote = `(after ${HTTP_DELIVERY_MAX_ATTEMPTS} attempts)`;
    return {
      ...outcome,
      detail: truncate(outcome.detail ? `${outcome.detail} ${attemptsNote}` : attemptsNote),
    };
  }
  return outcome;
};

/** Best-effort secret decrypt — a bad/rotated encryption key must not crash dispatch. */
const resolveSecret = (config: WebhookRuleConfigPO): string | undefined => {
  if (!("secret" in config) || !config.secret) return undefined;
  try {
    return decryptWebhookSecret(config.secret);
  } catch (error) {
    console.error("[busabase] failed to decrypt webhook secret for dispatch", error);
    return undefined;
  }
};

const recordDelivery = async (
  db: BusabaseDatabase,
  args: { ruleId: string; spaceId: string; eventType: WebhookEventType; outcome: DeliveryOutcome },
): Promise<WebhookDeliveryRow> => {
  const [row] = await db
    .insert(busabaseWebhookDeliveries)
    .values({
      id: id("whd"),
      ruleId: args.ruleId,
      spaceId: args.spaceId,
      eventType: args.eventType,
      status: args.outcome.status,
      httpStatus: args.outcome.httpStatus,
      detail: args.outcome.detail,
      durationMs: args.outcome.durationMs,
      createdAt: now(),
    })
    .returning();
  if (!row) {
    throw new Error("Failed to record webhook delivery");
  }
  // Best-effort — a failure to update the rule's rollup fields must not
  // prevent the delivery record itself from having been written above.
  try {
    await db
      .update(busabaseWebhookRules)
      .set({ lastTriggeredAt: now(), lastStatus: args.outcome.status })
      .where(eq(busabaseWebhookRules.id, args.ruleId));
  } catch (error) {
    console.error("[busabase] failed to update webhook rule lastTriggeredAt/lastStatus", error);
  }
  return row;
};

/**
 * Dispatch ONE rule for the given `eventType` + `payload`, recording exactly
 * one delivery row and returning it. The only place that decides how to
 * deliver per `actionKind` (`webhook`/`notify_agent` sign-and-POST vs.
 * `run_snippet` sandbox-then-maybe-POST) — both `dispatchWebhookEvent` (real
 * events) and `testFireRule` (on-demand test fire) call this so retries,
 * signing, and sandbox execution behave identically for both. Exported for
 * `testFireRule`'s use below; never throws except if `recordDelivery` itself
 * fails twice in a row (nothing left to persist or return in that case).
 */
export const dispatchOneRule = async (
  db: BusabaseDatabase,
  rule: WebhookRuleRow,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<WebhookDeliveryRow> => {
  try {
    if (rule.actionKind === "webhook" || rule.actionKind === "notify_agent") {
      const config = rule.config as WebhookRuleHttpConfigPO;
      const body = JSON.stringify({ event: eventType, ...payload });
      const outcome = await performHttpDelivery({
        url: config.targetUrl,
        headers: config.headers,
        secret: resolveSecret(rule.config),
        body,
      });
      return await recordDelivery(db, {
        ruleId: rule.id,
        spaceId: rule.spaceId,
        eventType,
        outcome,
      });
    }

    // run_snippet: compute in the sandbox (no network access there), then —
    // only if the snippet returned a valid call spec — perform the one HTTP
    // call it asked for through the same signed-delivery path as above.
    const config = rule.config as WebhookRuleSnippetConfigPO;
    const snippetResult = await runSnippet(
      config.code,
      { event: eventType, ...payload },
      config.timeoutMs,
    );

    if (snippetResult.error) {
      const detail = snippetResult.logs
        ? `${snippetResult.error}\nlogs:\n${snippetResult.logs}`
        : snippetResult.error;
      return await recordDelivery(db, {
        ruleId: rule.id,
        spaceId: rule.spaceId,
        eventType,
        outcome: { status: "failed", httpStatus: null, detail: truncate(detail), durationMs: null },
      });
    }

    const parsedCall = SnippetCallSpecSchema.safeParse(snippetResult.result);
    if (!parsedCall.success) {
      // "Just compute, don't call anything" is a valid outcome, not a failure.
      return await recordDelivery(db, {
        ruleId: rule.id,
        spaceId: rule.spaceId,
        eventType,
        outcome: {
          status: "success",
          httpStatus: null,
          detail: truncate(snippetResult.logs || "Snippet computed a value without calling out."),
          durationMs: null,
        },
      });
    }

    const call = parsedCall.data;
    const outcome = await performHttpDelivery({
      url: call.url,
      method: call.method,
      headers: call.headers,
      // The snippet computed its own target/headers; a `run_snippet` config
      // never carries a rule-level secret to sign with (see contract types).
      secret: undefined,
      body: call.body !== undefined ? JSON.stringify(call.body) : "",
    });
    return await recordDelivery(db, { ruleId: rule.id, spaceId: rule.spaceId, eventType, outcome });
  } catch (error) {
    // Nothing above should throw, but a rule with a malformed config (or any
    // other surprise) must never take down the rest of the dispatch batch —
    // `dispatchWebhookEvent` fans this out via Promise.allSettled, so even a
    // rejection here (the double-failure case below) can't break other rules.
    console.error("[busabase] webhook dispatch failed unexpectedly", error);
    try {
      return await recordDelivery(db, {
        ruleId: rule.id,
        spaceId: rule.spaceId,
        eventType,
        outcome: {
          status: "failed",
          httpStatus: null,
          detail: truncate(error instanceof Error ? error.message : String(error)),
          durationMs: null,
        },
      });
    } catch (innerError) {
      console.error("[busabase] failed to record webhook delivery failure", innerError);
      throw innerError;
    }
  }
};

/**
 * Dispatch every enabled rule matching `spaceId` + `eventType` (space-wide
 * rules where `baseId` is null, plus rules scoped to `args.baseId` when set)
 * concurrently. Never throws — a bad rule config or a network failure must
 * never propagate into the caller (record merge / comment creation / review)
 * and break that unrelated flow, matching the best-effort philosophy of the
 * `notifyAgentOfChangeRequest` mechanism this generalizes — just now with a
 * persisted delivery-log row instead of silence.
 */
export const dispatchWebhookEvent = async (
  db: BusabaseDatabase,
  args: {
    spaceId: string;
    baseId: string | null;
    eventType: WebhookEventType;
    payload: Record<string, unknown>;
  },
): Promise<void> => {
  try {
    const rules = await db
      .select()
      .from(busabaseWebhookRules)
      .where(
        and(
          eq(busabaseWebhookRules.spaceId, args.spaceId),
          eq(busabaseWebhookRules.eventType, args.eventType),
          eq(busabaseWebhookRules.enabled, true),
          args.baseId
            ? or(isNull(busabaseWebhookRules.baseId), eq(busabaseWebhookRules.baseId, args.baseId))
            : isNull(busabaseWebhookRules.baseId),
        ),
      );

    if (rules.length === 0) return;

    await Promise.allSettled(
      rules.map((rule) => dispatchOneRule(db, rule, args.eventType, args.payload)),
    );
  } catch (error) {
    console.error("[busabase] dispatchWebhookEvent failed unexpectedly", error);
  }
};

// Synthetic ids used in a test-fire payload — never a real record/CR, so a
// receiving endpoint can tell (alongside `_test: true`) that this delivery
// didn't come from a real event.
const TEST_FIRE_RECORD_ID = "test-record";
const TEST_FIRE_CHANGE_REQUEST_ID = "test-change-request";

/**
 * Build a payload representative of what a real event of `rule.eventType`
 * would send — matching the exact shapes `dispatchWebhookEvent`'s real
 * callers build in cr-lifecycle.ts (the `record.created` dispatch inside
 * `_mergeChangeRequest`, and `notifyAgentOfChangeRequest` for `ai_mention` /
 * `changes_requested`), so a test-fire looks like the real thing.
 */
const buildTestFirePayload = (rule: WebhookRuleRow): Record<string, unknown> => {
  if (rule.eventType === "record.created") {
    return {
      recordId: TEST_FIRE_RECORD_ID,
      baseId: rule.baseId,
      changeRequestId: TEST_FIRE_CHANGE_REQUEST_ID,
      fields: {
        title: "Test record",
        note: "This is a synthetic test-fire payload, not a real event.",
      },
      _test: true,
    };
  }
  // ai_mention / changes_requested — same shape `notifyAgentOfChangeRequest` sends.
  return {
    event: "agent.task",
    trigger: rule.eventType,
    changeRequestId: TEST_FIRE_CHANGE_REQUEST_ID,
    _test: true,
  };
};

/**
 * Fire ONE specific rule right now with a synthetic payload, for the
 * `webhooks.testFire` "test this rule" endpoint — bypassing the normal
 * spaceId + eventType + enabled rule lookup `dispatchWebhookEvent` does.
 * Runs regardless of `rule.enabled` and regardless of whether `rule.eventType`
 * matches anything live, and goes through the exact same `dispatchOneRule`
 * used by real dispatch (retries, signing, sandbox execution all behave
 * identically) — no divergent test-only delivery path.
 */
export const testFireRule = async (
  db: BusabaseDatabase,
  rule: WebhookRuleRow,
): Promise<WebhookDeliveryVO> => {
  const payload = buildTestFirePayload(rule);
  const row = await dispatchOneRule(db, rule, rule.eventType, payload);
  return toWebhookDeliveryVO(row);
};
