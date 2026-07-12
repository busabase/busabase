import "server-only";

import { createHmac } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import type { BusabaseDatabase } from "../../../context";
import { id, now } from "../../../logic/kernel";
import { busabaseWebhookDeliveries } from "../schema/webhook-deliveries";
import {
  busabaseWebhookRules,
  type WebhookRuleConfigPO,
  type WebhookRuleFunctionConfigPO,
  type WebhookRuleHttpConfigPO,
} from "../schema/webhook-rules";
import type { WebhookDeliveryStatus, WebhookDeliveryVO, WebhookEventType } from "../types/webhook";
import { runFunction } from "./sandbox";
import { checkUrlIsSafeToFetch } from "./ssrf-guard";
import { decryptWebhookSecret } from "./webhook-crypto";
import { toWebhookDeliveryVO } from "./webhook-logic";

type WebhookRuleRow = typeof busabaseWebhookRules.$inferSelect;
type WebhookDeliveryRow = typeof busabaseWebhookDeliveries.$inferSelect;

// Delivery `detail` holds truncated response bodies / error messages /
// captured function console.log output — cap it to a few KB so a chatty
// endpoint or function can't bloat the deliveries table.
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

const truncate = (value: string, max = DETAIL_MAX_CHARS): string =>
  value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;

interface DeliveryOutcome {
  status: WebhookDeliveryStatus;
  httpStatus: number | null;
  detail: string | null;
  durationMs: number | null;
}

/**
 * The delivery path for the `webhook` / `notify_agent` actions — signs the
 * body with the rule's decrypted secret, when present, as
 * `X-Busabase-Signature` (HMAC-SHA256 hex over the raw body), and records
 * exactly one delivery row per dispatch. This is NOT the only place network
 * I/O happens for webhook dispatch anymore: a `run_function` rule's sandboxed
 * code now makes its own outbound calls directly via the `fetch` bridge in
 * `sandbox.ts` (SSRF-guarded the same way, but with no retry — see
 * `dispatchOneRule` below).
 *
 * Retries a failed attempt (thrown error, timeout, or non-2xx response) with
 * exponential backoff, up to HTTP_DELIVERY_MAX_ATTEMPTS total attempts — a
 * single flaky attempt must not sink the whole delivery. Only the LAST
 * attempt's outcome is returned/persisted; its `detail` notes how many
 * attempts were made when the final outcome is a failure, so the delivery
 * log stays debuggable.
 *
 * Before every attempt, `checkUrlIsSafeToFetch` (see `./ssrf-guard`)
 * re-validates `args.url` isn't pointing at a blocked
 * (loopback/link-local/private/metadata) address. A blocked target fails
 * IMMEDIATELY (no fetch attempted, no backoff sleep, no burning the
 * remaining retries) since it's a config problem, not a flaky network blip.
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
 * `run_function` sandboxed execution) — both `dispatchWebhookEvent` (real
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

    // run_function: execute the sandboxed code, which makes its own outbound
    // calls (if any) directly via the sandbox's `fetch` bridge (see
    // sandbox.ts) — no host-performed call spec anymore, so there's no
    // meaningful single HTTP status/duration to record; the function may
    // have made zero, one, or several fetch calls internally. `status` is
    // success/failed based purely on whether the function itself errored
    // (threw, timed out, or returned something non-JSON-serializable); its
    // captured logs (+ error, if any) are what make the delivery debuggable.
    const config = rule.config as WebhookRuleFunctionConfigPO;
    const functionResult = await runFunction(
      config.code,
      { event: eventType, ...payload },
      config.timeoutMs,
    );

    const detail = functionResult.error
      ? functionResult.logs
        ? `${functionResult.error}\nlogs:\n${functionResult.logs}`
        : functionResult.error
      : functionResult.logs || null;

    return await recordDelivery(db, {
      ruleId: rule.id,
      spaceId: rule.spaceId,
      eventType,
      outcome: {
        status: functionResult.error ? "failed" : "success",
        httpStatus: null,
        detail: detail ? truncate(detail) : null,
        durationMs: null,
      },
    });
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

// Synthetic ids used in a test-fire payload — never a real record/CR/asset, so
// a receiving endpoint can tell (alongside `_test: true`) that this delivery
// didn't come from a real event.
const TEST_FIRE_RECORD_ID = "test-record";
const TEST_FIRE_CHANGE_REQUEST_ID = "test-change-request";
const TEST_FIRE_ASSET_ID = "test-asset";

/**
 * Build a payload representative of what a real event of `rule.eventType`
 * would send — matching the exact shapes `dispatchWebhookEvent`'s real
 * callers build in cr-lifecycle.ts (the `record.created` dispatch inside
 * `_mergeChangeRequest`, and `notifyAgentOfChangeRequest` for `ai_mention` /
 * `changes_requested`) and assets/handlers.ts (`confirmAssetUpload`'s
 * `asset.uploaded` dispatch), so a test-fire looks like the real thing.
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
  if (rule.eventType === "asset.uploaded") {
    return {
      assetId: TEST_FIRE_ASSET_ID,
      fileName: "test-document.pdf",
      mimeType: "application/pdf",
      textStatus: "missing",
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
