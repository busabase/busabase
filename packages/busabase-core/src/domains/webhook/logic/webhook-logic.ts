import "server-only";

import { ORPCError } from "@orpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import type { BusabaseDatabase } from "../../../context";
import { id, now } from "../../../logic/kernel";
import { busabaseWebhookDeliveries } from "../schema/webhook-deliveries";
import {
  busabaseWebhookRules,
  type WebhookRuleConfigPO,
  type WebhookRuleFunctionConfigPO,
  type WebhookRuleHttpConfigPO,
} from "../schema/webhook-rules";
import type {
  WebhookDeliveryVO,
  WebhookFunctionConfigVO,
  WebhookHttpConfig,
  WebhookHttpConfigVO,
  WebhookRuleInput,
  WebhookRuleUpdateInput,
  WebhookRuleVO,
} from "../types/webhook";
import { checkUrlIsSafeToFetch } from "./ssrf-guard";
import { encryptWebhookSecret } from "./webhook-crypto";

type WebhookRuleRow = typeof busabaseWebhookRules.$inferSelect;
type WebhookDeliveryRow = typeof busabaseWebhookDeliveries.$inferSelect;

// A generous v1 ceiling: high enough real usage never bumps into it, tight
// enough to bound one space spamming itself into an unbounded rules table
// (and, transitively, unbounded fan-out on every dispatched event).
export const MAX_WEBHOOK_RULES_PER_SPACE = 50;

const toHttpConfigVO = (config: WebhookRuleHttpConfigPO): WebhookHttpConfigVO => ({
  targetUrl: config.targetUrl,
  hasSecret: Boolean(config.secret),
  headers: config.headers,
});

const toFunctionConfigVO = (config: WebhookRuleFunctionConfigPO): WebhookFunctionConfigVO => ({
  code: config.code,
  timeoutMs: config.timeoutMs,
});

/**
 * PO → VO, redacting any secret down to a boolean `hasSecret`. Never decrypts
 * or otherwise touches the actual secret value — that only happens at
 * dispatch time (see `./dispatch.ts`).
 */
export const toWebhookRuleVO = (po: WebhookRuleRow): WebhookRuleVO => {
  const commonFields = {
    id: po.id,
    spaceId: po.spaceId,
    baseId: po.baseId,
    name: po.name,
    eventType: po.eventType,
    enabled: po.enabled,
    createdBy: po.createdBy,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    lastTriggeredAt: po.lastTriggeredAt ? po.lastTriggeredAt.toISOString() : null,
    lastStatus: po.lastStatus,
  };

  switch (po.actionKind) {
    case "run_function":
      return {
        ...commonFields,
        actionKind: "run_function",
        config: toFunctionConfigVO(po.config as WebhookRuleFunctionConfigPO),
      };
    case "webhook":
      return {
        ...commonFields,
        actionKind: "webhook",
        config: toHttpConfigVO(po.config as WebhookRuleHttpConfigPO),
      };
    case "notify_agent":
      return {
        ...commonFields,
        actionKind: "notify_agent",
        config: toHttpConfigVO(po.config as WebhookRuleHttpConfigPO),
      };
    default: {
      const exhaustive: never = po.actionKind;
      throw new Error(`Unknown webhook action kind: ${exhaustive as string}`);
    }
  }
};

export const toWebhookDeliveryVO = (po: WebhookDeliveryRow): WebhookDeliveryVO => ({
  id: po.id,
  ruleId: po.ruleId,
  eventType: po.eventType,
  status: po.status,
  httpStatus: po.httpStatus,
  detail: po.detail,
  durationMs: po.durationMs,
  createdAt: po.createdAt.toISOString(),
});

const buildHttpConfigPO = (
  input: WebhookHttpConfig,
  existingConfig?: WebhookRuleConfigPO,
): WebhookRuleHttpConfigPO => {
  // Preserve the previously-stored (encrypted) secret when an update omits
  // one — an edit that doesn't resend the secret must not wipe it.
  const existingSecret =
    existingConfig && "secret" in existingConfig ? existingConfig.secret : undefined;
  const secret = input.secret ? encryptWebhookSecret(input.secret) : existingSecret;
  return {
    targetUrl: input.targetUrl,
    ...(secret ? { secret } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
  };
};

/**
 * Reject an obviously-unsafe targetUrl at create/update time instead of only
 * discovering it the first time the rule fires. This mirrors — but does not
 * replace — the real SSRF gate `checkUrlIsSafeToFetch` already runs before
 * EVERY dispatch attempt (dispatch.ts): a host can still change what it
 * resolves to after this check passes (DNS rebinding), so dispatch-time
 * enforcement stays load-bearing. This is purely a fast, friendlier rejection
 * for the common case (a target that's already unreachable/blocked right now),
 * matching contract-layer input validation's spirit of failing fast on bad
 * input. `run_function` rules have no `targetUrl` and are skipped.
 */
const assertTargetUrlIsSafe = async (
  input: WebhookRuleInput | WebhookRuleUpdateInput,
): Promise<void> => {
  if (input.actionKind === "run_function") return;
  const safety = await checkUrlIsSafeToFetch(input.config.targetUrl);
  if (safety.blocked) {
    throw new ORPCError("BAD_REQUEST", {
      message: `targetUrl is not allowed: ${safety.reason ?? "blocked by SSRF protection"}`,
    });
  }
};

const buildConfigPO = (
  input: WebhookRuleInput | WebhookRuleUpdateInput,
  existingConfig?: WebhookRuleConfigPO,
): WebhookRuleConfigPO => {
  if (input.actionKind === "run_function") {
    return { code: input.config.code, timeoutMs: input.config.timeoutMs };
  }
  return buildHttpConfigPO(input.config, existingConfig);
};

/**
 * The raw PO row (not the redacted VO) — needed by the `webhooks.testFire`
 * router handler so it can hand the full rule (including its still-encrypted
 * secret) to `testFireRule` in `./dispatch`, exactly as the real dispatch
 * path already works with PO rows.
 */
export const getWebhookRuleRow = async (
  db: BusabaseDatabase,
  spaceId: string,
  ruleId: string,
): Promise<WebhookRuleRow | null> => {
  const [row] = await db
    .select()
    .from(busabaseWebhookRules)
    .where(and(eq(busabaseWebhookRules.id, ruleId), eq(busabaseWebhookRules.spaceId, spaceId)))
    .limit(1);
  return row ?? null;
};

export const listWebhookRules = async (
  db: BusabaseDatabase,
  spaceId: string,
): Promise<WebhookRuleVO[]> => {
  const rows = await db
    .select()
    .from(busabaseWebhookRules)
    .where(eq(busabaseWebhookRules.spaceId, spaceId))
    .orderBy(desc(busabaseWebhookRules.createdAt));
  return rows.map(toWebhookRuleVO);
};

export const getWebhookRule = async (
  db: BusabaseDatabase,
  spaceId: string,
  ruleId: string,
): Promise<WebhookRuleVO | null> => {
  const row = await getWebhookRuleRow(db, spaceId, ruleId);
  return row ? toWebhookRuleVO(row) : null;
};

export const createWebhookRule = async (
  db: BusabaseDatabase,
  spaceId: string,
  actorId: string,
  input: WebhookRuleInput,
): Promise<WebhookRuleVO> => {
  const [ruleCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(busabaseWebhookRules)
    .where(eq(busabaseWebhookRules.spaceId, spaceId));
  if ((ruleCountRow?.count ?? 0) >= MAX_WEBHOOK_RULES_PER_SPACE) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: `Webhook rule limit reached (max ${MAX_WEBHOOK_RULES_PER_SPACE} per space) — delete an existing rule before creating another.`,
    });
  }
  await assertTargetUrlIsSafe(input);

  const timestamp = now();
  const config = buildConfigPO(input);
  const [row] = await db
    .insert(busabaseWebhookRules)
    .values({
      id: id("wh"),
      spaceId,
      baseId: input.baseId ?? null,
      name: input.name,
      eventType: input.eventType,
      actionKind: input.actionKind,
      config,
      enabled: input.enabled,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastTriggeredAt: null,
      lastStatus: null,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create webhook rule");
  }
  return toWebhookRuleVO(row);
};

export const updateWebhookRule = async (
  db: BusabaseDatabase,
  spaceId: string,
  // Reserved for future audit-log parity with the rest of the kernel (every
  // other mutation in this codebase threads an actor through); not needed by
  // the update itself since `createdBy` never changes on edit.
  _actorId: string,
  ruleId: string,
  // Takes the full (discriminated-union) input including `id` — `Omit<T, "id">`
  // does not distribute over a union and would collapse the actionKind/config
  // correlation `buildConfigPO` relies on. `ruleId` (not `input.id`) is what's
  // actually used to address the row.
  input: WebhookRuleUpdateInput,
): Promise<WebhookRuleVO> => {
  const existing = await getWebhookRuleRow(db, spaceId, ruleId);
  if (!existing) {
    throw new ORPCError("NOT_FOUND", { message: `Webhook rule not found: ${ruleId}` });
  }
  await assertTargetUrlIsSafe(input);
  const config = buildConfigPO(input, existing.config);
  const [row] = await db
    .update(busabaseWebhookRules)
    .set({
      baseId: input.baseId ?? null,
      name: input.name,
      eventType: input.eventType,
      actionKind: input.actionKind,
      config,
      enabled: input.enabled,
      updatedAt: now(),
    })
    .where(and(eq(busabaseWebhookRules.id, ruleId), eq(busabaseWebhookRules.spaceId, spaceId)))
    .returning();
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: `Webhook rule not found: ${ruleId}` });
  }
  return toWebhookRuleVO(row);
};

export const deleteWebhookRule = async (
  db: BusabaseDatabase,
  spaceId: string,
  ruleId: string,
): Promise<{ success: boolean }> => {
  const result = await db
    .delete(busabaseWebhookRules)
    .where(and(eq(busabaseWebhookRules.id, ruleId), eq(busabaseWebhookRules.spaceId, spaceId)))
    .returning({ id: busabaseWebhookRules.id });
  return { success: result.length > 0 };
};

export const listWebhookDeliveries = async (
  db: BusabaseDatabase,
  ruleId: string,
  limit: number,
): Promise<WebhookDeliveryVO[]> => {
  const rows = await db
    .select()
    .from(busabaseWebhookDeliveries)
    .where(eq(busabaseWebhookDeliveries.ruleId, ruleId))
    .orderBy(desc(busabaseWebhookDeliveries.createdAt))
    .limit(limit);
  return rows.map(toWebhookDeliveryVO);
};
