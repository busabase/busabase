import { eq } from "drizzle-orm";
import type { BusabaseDatabase } from "../../../context";
import { busabaseUserEnvVars } from "../schema/user-env-vars";
import { EnvVarsSchema, type UserEnvVO } from "../types/user-env";
import { decodeUserEnvPayload, encodeUserEnvPayload } from "./user-env-crypto";

type UserEnvRow = typeof busabaseUserEnvVars.$inferSelect;

const normalizeUserId = (userId: string | null | undefined) => userId?.trim() ?? "";

function normalizeEnv(raw: unknown) {
  if (!raw || typeof raw !== "object") return {};

  return EnvVarsSchema.parse(
    Object.fromEntries(
      Object.entries(raw as Record<string, unknown>)
        .map(([key, value]) => [key.trim().toUpperCase(), String(value ?? "")] as const)
        .filter(([key]) => key.length > 0),
    ),
  );
}

function toUserEnvVO(userId: string, row: UserEnvRow | undefined): UserEnvVO {
  return {
    userId: userId || null,
    env: row ? normalizeEnv(decodeUserEnvPayload(row.envPayload)) : {},
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function getUserEnv(
  db: BusabaseDatabase,
  userId: string | null | undefined,
): Promise<UserEnvVO> {
  const normalizedUserId = normalizeUserId(userId);
  const [row] = await db
    .select()
    .from(busabaseUserEnvVars)
    .where(eq(busabaseUserEnvVars.userId, normalizedUserId))
    .limit(1);

  return toUserEnvVO(normalizedUserId, row);
}

export async function getUserEnvVars(
  db: BusabaseDatabase,
  userId: string | null | undefined,
): Promise<Record<string, string>> {
  return (await getUserEnv(db, userId)).env;
}

export async function updateUserEnv(
  db: BusabaseDatabase,
  userId: string | null | undefined,
  input: { env: Record<string, string> },
  options: { requireEncryption?: boolean } = {},
): Promise<UserEnvVO> {
  const normalizedUserId = normalizeUserId(userId);
  const env = normalizeEnv(input.env);
  const envPayload = encodeUserEnvPayload(env, options);
  const now = new Date();
  const [row] = await db
    .insert(busabaseUserEnvVars)
    .values({
      userId: normalizedUserId,
      envPayload,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: busabaseUserEnvVars.userId,
      set: { envPayload, updatedAt: now },
    })
    .returning();

  return toUserEnvVO(normalizedUserId, row);
}

export async function clearUserEnv(
  db: BusabaseDatabase,
  userId: string | null | undefined,
): Promise<{ success: boolean }> {
  const normalizedUserId = normalizeUserId(userId);
  await db.delete(busabaseUserEnvVars).where(eq(busabaseUserEnvVars.userId, normalizedUserId));
  return { success: true };
}
