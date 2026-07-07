import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export interface PlainEnvVarsPayload {
  version: 1;
  encoding: "plain";
  env: Record<string, string>;
}

export interface EncryptedEnvVarsPayload {
  version: 1;
  encoding: "encrypted";
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

export type UserEnvVarsPayload = PlainEnvVarsPayload | EncryptedEnvVarsPayload;

export const busabaseUserEnvVars = pgTable("busabase_user_env_vars", {
  userId: text("user_id").primaryKey().notNull(),
  envPayload: jsonb("env_payload").$type<UserEnvVarsPayload>().notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});
