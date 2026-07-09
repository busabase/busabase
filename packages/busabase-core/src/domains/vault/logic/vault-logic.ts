import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BusabaseDatabase } from "../../../context";
import { busabaseVaultItems } from "../schema/vault-items";
import {
  UpdateVaultSettingsInputSchema,
  VaultAccessPolicySchema,
  type VaultItemInput,
  VaultItemInputSchema,
  type VaultItemVO,
  type VaultRuntimeEnv,
  VaultRuntimeEnvSchema,
  type VaultSettingsVO,
} from "../types/vault";
import { decodeVaultValue, encodeVaultValue } from "./vault-crypto";

type VaultItemRow = typeof busabaseVaultItems.$inferSelect;

const normalizeOwnerId = (userId: string | null | undefined) => userId?.trim() ?? "";

const createVaultItemId = () => `vault_${randomUUID()}`;

const defaultVaultAccess = {
  runtime: true,
  reveal: true,
  edit: true,
  share: false,
};

function normalizeItem(input: VaultItemInput): VaultItemInput {
  return VaultItemInputSchema.parse({
    ...input,
    id: input.id?.trim() || createVaultItemId(),
    key: input.key.trim().toUpperCase(),
    scopeId: input.scopeId?.trim() || null,
    description: input.description?.trim() ?? "",
    access: VaultAccessPolicySchema.parse(input.access ?? defaultVaultAccess),
  });
}

function normalizeItems(rawItems: unknown): VaultItemInput[] {
  const { items } = UpdateVaultSettingsInputSchema.parse({ items: rawItems });
  const deduped = new Map<string, VaultItemInput>();
  for (const item of items.map(normalizeItem)) {
    const key = [item.environment, item.scopeType, item.scopeId ?? "", item.key].join(":");
    const previous = deduped.get(key);
    deduped.set(key, {
      ...item,
      kind: previous?.kind === "secret" || item.kind === "secret" ? "secret" : item.kind,
    });
  }
  return [...deduped.values()];
}

function rowToVO(row: VaultItemRow): VaultItemVO {
  return {
    id: row.id,
    kind: row.kind,
    key: row.key,
    value: decodeVaultValue(row.valuePayload),
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    environment: row.environment,
    description: row.description,
    access: VaultAccessPolicySchema.parse(row.access),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

function toSettingsVO(ownerId: string, rows: VaultItemRow[]): VaultSettingsVO {
  const items = rows
    .map(rowToVO)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
  const updatedAt = items.reduce<string | null>(
    (latest, item) => (!latest || item.updatedAt > latest ? item.updatedAt : latest),
    null,
  );
  return {
    ownerId: ownerId || null,
    items,
    updatedAt,
  };
}

async function readVaultRows(db: BusabaseDatabase, ownerId: string): Promise<VaultItemRow[]> {
  return db.select().from(busabaseVaultItems).where(eq(busabaseVaultItems.userId, ownerId));
}

async function replaceVaultItems(
  db: BusabaseDatabase,
  ownerId: string,
  items: VaultItemInput[],
  options: { requireEncryption?: boolean } = {},
) {
  const now = new Date();
  await db.delete(busabaseVaultItems).where(eq(busabaseVaultItems.userId, ownerId));
  if (items.length === 0) return;

  await db.insert(busabaseVaultItems).values(
    items.map((item) => ({
      id: item.id ?? createVaultItemId(),
      userId: ownerId,
      kind: item.kind,
      key: item.key,
      valuePayload: encodeVaultValue(item.value, options),
      scopeType: item.scopeType,
      scopeId: item.scopeId ?? null,
      environment: item.environment,
      description: item.description ?? "",
      access: VaultAccessPolicySchema.parse(item.access ?? defaultVaultAccess),
      createdAt: now,
      updatedAt: now,
    })),
  );
}

export async function getVaultSettings(
  db: BusabaseDatabase,
  userId: string | null | undefined,
): Promise<VaultSettingsVO> {
  const ownerId = normalizeOwnerId(userId);
  const rows = await readVaultRows(db, ownerId);
  return toSettingsVO(ownerId, rows);
}

export async function updateVaultSettings(
  db: BusabaseDatabase,
  userId: string | null | undefined,
  input: { items: unknown[] },
  options: { requireEncryption?: boolean } = {},
): Promise<VaultSettingsVO> {
  const ownerId = normalizeOwnerId(userId);
  const items = normalizeItems(input.items);
  await replaceVaultItems(db, ownerId, items, options);
  return getVaultSettings(db, ownerId);
}

export async function clearVaultSettings(
  db: BusabaseDatabase,
  userId: string | null | undefined,
): Promise<{ success: boolean }> {
  const ownerId = normalizeOwnerId(userId);
  await db.delete(busabaseVaultItems).where(eq(busabaseVaultItems.userId, ownerId));
  return { success: true };
}

export async function getVaultRuntimeEnv(
  db: BusabaseDatabase,
  userId: string | null | undefined,
): Promise<VaultRuntimeEnv> {
  const settings = await getVaultSettings(db, userId);
  return VaultRuntimeEnvSchema.parse(
    Object.fromEntries(
      settings.items
        .filter((item) => item.access.runtime)
        .map((item) => [item.key, item.value] as const),
    ),
  );
}
