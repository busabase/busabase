import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { spaceIdColumn } from "../../../db/space-column";
import type { WebhookDeliveryStatus, WebhookEventType } from "./webhook-rules";

export const busabaseWebhookDeliveries = pgTable(
  "busabase_webhook_deliveries",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id").notNull(),
    spaceId: spaceIdColumn(),
    eventType: text("event_type").$type<WebhookEventType>().notNull(),
    status: text("status").$type<WebhookDeliveryStatus>().notNull(),
    httpStatus: integer("http_status"),
    // Truncated (a few KB max, see logic/dispatch.ts) response body / error
    // message / captured snippet console.log output — never the raw payload.
    detail: text("detail"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("busabase_webhook_deliveries_rule_created_idx").on(table.ruleId, table.createdAt),
  ],
);

export type WebhookDeliveryPO = typeof busabaseWebhookDeliveries.$inferSelect;
export type WebhookDeliveryInsertPO = typeof busabaseWebhookDeliveries.$inferInsert;
