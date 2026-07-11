import { boolean, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { spaceIdColumn } from "../../../db/space-column";

export type WebhookEventType = "record.created" | "ai_mention" | "changes_requested";
export type WebhookActionKind = "webhook" | "notify_agent" | "run_snippet";
export type WebhookDeliveryStatus = "success" | "failed" | "skipped";

/**
 * Secret payload stored inside a rule's `config` jsonb — AES-256-GCM, same
 * key-resolution + algorithm as the Vault domain (see `../logic/webhook-crypto.ts`).
 * Never stored plaintext.
 */
export interface EncryptedWebhookSecretPayload {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface WebhookRuleHttpConfigPO {
  targetUrl: string;
  secret?: EncryptedWebhookSecretPayload;
  headers?: Record<string, string>;
}

export interface WebhookRuleSnippetConfigPO {
  code: string;
  timeoutMs: number;
}

export type WebhookRuleConfigPO = WebhookRuleHttpConfigPO | WebhookRuleSnippetConfigPO;

export const busabaseWebhookRules = pgTable(
  "busabase_webhook_rules",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    // Space-wide when null; scoped to one Base otherwise. No FK — a rule can
    // outlive/predate the base reference check, which the logic layer enforces.
    baseId: text("base_id"),
    name: text("name").notNull(),
    eventType: text("event_type").$type<WebhookEventType>().notNull(),
    actionKind: text("action_kind").$type<WebhookActionKind>().notNull(),
    config: jsonb("config").$type<WebhookRuleConfigPO>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
    lastTriggeredAt: timestamp("last_triggered_at", { mode: "date" }),
    lastStatus: text("last_status").$type<WebhookDeliveryStatus>(),
  },
  (table) => [
    // Dispatch lookup: "which enabled rules watch this event in this space".
    index("busabase_webhook_rules_space_event_enabled_idx").on(
      table.spaceId,
      table.eventType,
      table.enabled,
    ),
  ],
);

export type WebhookRulePO = typeof busabaseWebhookRules.$inferSelect;
export type WebhookRuleInsertPO = typeof busabaseWebhookRules.$inferInsert;
