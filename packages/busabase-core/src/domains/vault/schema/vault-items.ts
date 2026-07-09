import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export type VaultItemKind = "secret" | "variable";
export type VaultScopeType = "personal" | "workspace" | "base" | "agent" | "tool" | "api_key";
export type VaultEnvironment = "local" | "development" | "staging" | "production";

export interface VaultAccessPolicy {
  runtime: boolean;
  reveal: boolean;
  edit: boolean;
  share: boolean;
}

export interface PlainVaultValuePayload {
  version: 1;
  encoding: "plain";
  value: string;
}

export interface EncryptedVaultValuePayload {
  version: 1;
  encoding: "encrypted";
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

export type VaultValuePayload = PlainVaultValuePayload | EncryptedVaultValuePayload;

export const busabaseVaultItems = pgTable(
  "busabase_vault_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").$type<VaultItemKind>().notNull(),
    key: text("key").notNull(),
    valuePayload: jsonb("value_payload").$type<VaultValuePayload>().notNull(),
    scopeType: text("scope_type").$type<VaultScopeType>().notNull().default("personal"),
    scopeId: text("scope_id"),
    environment: text("environment").$type<VaultEnvironment>().notNull().default("local"),
    description: text("description").notNull().default(""),
    access: jsonb("access")
      .$type<VaultAccessPolicy>()
      .notNull()
      .default({ runtime: true, reveal: true, edit: true, share: false }),
    lastUsedAt: timestamp("last_used_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("busabase_vault_items_user_updated_idx").on(table.userId, table.updatedAt),
    index("busabase_vault_items_user_kind_idx").on(table.userId, table.kind),
    index("busabase_vault_items_user_key_idx").on(table.userId, table.key),
  ],
);
