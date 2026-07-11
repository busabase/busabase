import { z } from "zod";

export const WebhookEventTypeSchema = z.enum(["record.created", "ai_mention", "changes_requested"]);
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

export const WebhookActionKindSchema = z.enum(["webhook", "notify_agent", "run_snippet"]);
export type WebhookActionKind = z.infer<typeof WebhookActionKindSchema>;

export const WebhookDeliveryStatusSchema = z.enum(["success", "failed", "skipped"]);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatusSchema>;

// ── Per-action config (input/DTO side) ──────────────────────────────────────

// Shared by `webhook` and `notify_agent` — both fire a signed HTTP POST, the
// only difference is intent (an arbitrary URL vs. the agent-notification
// mechanism this generalizes). `secret` is optional and, when set, is used to
// HMAC-sign the request body (see dispatch.ts in busabase-core).
export const WebhookHttpConfigSchema = z.object({
  targetUrl: z.string().url(),
  secret: z.string().min(1).max(256).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type WebhookHttpConfig = z.infer<typeof WebhookHttpConfigSchema>;

export const WebhookSnippetConfigSchema = z.object({
  code: z.string().min(1).max(20000),
  timeoutMs: z.number().int().min(100).max(5000).default(2000),
});
export type WebhookSnippetConfig = z.infer<typeof WebhookSnippetConfigSchema>;

// ── Per-action config (output/VO side) — secret is NEVER echoed back ───────

export const WebhookHttpConfigVOSchema = z.object({
  targetUrl: z.string().url(),
  hasSecret: z.boolean(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type WebhookHttpConfigVO = z.infer<typeof WebhookHttpConfigVOSchema>;

// Snippet config has no secret to redact — safe to expose as-is.
export const WebhookSnippetConfigVOSchema = WebhookSnippetConfigSchema;
export type WebhookSnippetConfigVO = z.infer<typeof WebhookSnippetConfigVOSchema>;

// ── Rule input (create / update) ────────────────────────────────────────────
//
// Discriminated on `actionKind` so the config shape is actually enforced per
// action at parse time (a `run_snippet` rule can't be created with a
// `targetUrl`, a `webhook` rule can't be created with `code`, etc).

const webhookRuleCommonInputFields = {
  name: z.string().min(1).max(200),
  eventType: WebhookEventTypeSchema,
  baseId: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
};

export const WebhookRuleInputSchema = z.discriminatedUnion("actionKind", [
  z.object({
    ...webhookRuleCommonInputFields,
    actionKind: z.literal("webhook"),
    config: WebhookHttpConfigSchema,
  }),
  z.object({
    ...webhookRuleCommonInputFields,
    actionKind: z.literal("notify_agent"),
    config: WebhookHttpConfigSchema,
  }),
  z.object({
    ...webhookRuleCommonInputFields,
    actionKind: z.literal("run_snippet"),
    config: WebhookSnippetConfigSchema,
  }),
]);
export type WebhookRuleInput = z.infer<typeof WebhookRuleInputSchema>;

export const WebhookRuleUpdateInputSchema = z.discriminatedUnion("actionKind", [
  z.object({
    id: z.string(),
    ...webhookRuleCommonInputFields,
    actionKind: z.literal("webhook"),
    config: WebhookHttpConfigSchema,
  }),
  z.object({
    id: z.string(),
    ...webhookRuleCommonInputFields,
    actionKind: z.literal("notify_agent"),
    config: WebhookHttpConfigSchema,
  }),
  z.object({
    id: z.string(),
    ...webhookRuleCommonInputFields,
    actionKind: z.literal("run_snippet"),
    config: WebhookSnippetConfigSchema,
  }),
]);
export type WebhookRuleUpdateInput = z.infer<typeof WebhookRuleUpdateInputSchema>;

// ── Rule VO ──────────────────────────────────────────────────────────────────

const webhookRuleVOCommonFields = {
  id: z.string(),
  spaceId: z.string(),
  baseId: z.string().nullable(),
  name: z.string(),
  eventType: WebhookEventTypeSchema,
  enabled: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastTriggeredAt: z.string().nullable(),
  lastStatus: WebhookDeliveryStatusSchema.nullable(),
};

export const WebhookRuleVOSchema = z.discriminatedUnion("actionKind", [
  z.object({
    ...webhookRuleVOCommonFields,
    actionKind: z.literal("webhook"),
    config: WebhookHttpConfigVOSchema,
  }),
  z.object({
    ...webhookRuleVOCommonFields,
    actionKind: z.literal("notify_agent"),
    config: WebhookHttpConfigVOSchema,
  }),
  z.object({
    ...webhookRuleVOCommonFields,
    actionKind: z.literal("run_snippet"),
    config: WebhookSnippetConfigVOSchema,
  }),
]);
export type WebhookRuleVO = z.infer<typeof WebhookRuleVOSchema>;

// ── Delivery VO ──────────────────────────────────────────────────────────────

export const WebhookDeliveryVOSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  eventType: WebhookEventTypeSchema,
  status: WebhookDeliveryStatusSchema,
  httpStatus: z.number().nullable(),
  detail: z.string().nullable(),
  durationMs: z.number().nullable(),
  createdAt: z.string(),
});
export type WebhookDeliveryVO = z.infer<typeof WebhookDeliveryVOSchema>;

// ── List inputs ──────────────────────────────────────────────────────────────

export const ListWebhookRulesInputSchema = z.object({}).optional().default({});
export type ListWebhookRulesInput = z.infer<typeof ListWebhookRulesInputSchema>;

export const ListWebhookDeliveriesInputSchema = z.object({
  ruleId: z.string(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListWebhookDeliveriesInput = z.infer<typeof ListWebhookDeliveriesInputSchema>;
