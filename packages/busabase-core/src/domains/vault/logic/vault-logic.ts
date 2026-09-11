import { randomUUID } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import type { BusabaseDatabase } from "../../../context";
import { busabaseVaultItems } from "../schema/vault-items";
import {
  PREVIEWFILE_API_KEY,
  UpdateVaultSettingsInputSchema,
  VaultAccessPolicySchema,
  type VaultItemInput,
  VaultItemInputSchema,
  VaultItemKeySchema,
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

const HIDDEN_VAULT_KEYS = [PREVIEWFILE_API_KEY] as const;

const isHiddenVaultKey = (key: string): boolean =>
  HIDDEN_VAULT_KEYS.includes(key as (typeof HIDDEN_VAULT_KEYS)[number]);

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
  options: { requireEncryption?: boolean; preserveHidden?: boolean } = {},
) {
  const now = new Date();
  await db
    .delete(busabaseVaultItems)
    .where(
      options.preserveHidden
        ? and(
            eq(busabaseVaultItems.userId, ownerId),
            notInArray(busabaseVaultItems.key, [...HIDDEN_VAULT_KEYS]),
          )
        : eq(busabaseVaultItems.userId, ownerId),
    );
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
  return toSettingsVO(
    ownerId,
    rows.filter((row) => !isHiddenVaultKey(row.key)),
  );
}

export async function updateVaultSettings(
  db: BusabaseDatabase,
  userId: string | null | undefined,
  input: { items: unknown[] },
  options: { requireEncryption?: boolean } = {},
): Promise<VaultSettingsVO> {
  const ownerId = normalizeOwnerId(userId);
  const items = normalizeItems(input.items).filter((item) => !isHiddenVaultKey(item.key));
  await replaceVaultItems(db, ownerId, items, { ...options, preserveHidden: true });
  return getVaultSettings(db, ownerId);
}

/**
 * Manage PreviewFile's browser-hidden Vault item without replacing unrelated
 * user settings. The plaintext enters in the request body but is never echoed
 * through either this operation or `getVaultSettings`.
 */
export async function updatePreviewFileCredential(
  db: BusabaseDatabase,
  userId: string | null | undefined,
  apiKey: string | null,
): Promise<{ success: boolean }> {
  const ownerId = normalizeOwnerId(userId);
  await db
    .delete(busabaseVaultItems)
    .where(
      and(eq(busabaseVaultItems.userId, ownerId), eq(busabaseVaultItems.key, PREVIEWFILE_API_KEY)),
    );
  if (apiKey !== null) {
    const item = normalizeItem({
      kind: "secret",
      key: PREVIEWFILE_API_KEY,
      value: apiKey,
      scopeType: "personal",
      scopeId: null,
      environment: "local",
      description: "PreviewFile API key for Drive file previews",
      access: { runtime: true, reveal: false, edit: true, share: false },
    });
    await db.insert(busabaseVaultItems).values({
      id: item.id ?? createVaultItemId(),
      userId: ownerId,
      kind: item.kind,
      key: item.key,
      valuePayload: encodeVaultValue(item.value),
      scopeType: item.scopeType,
      scopeId: item.scopeId ?? null,
      environment: item.environment,
      description: item.description ?? "",
      access: VaultAccessPolicySchema.parse(item.access ?? defaultVaultAccess),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  return { success: true };
}

export async function clearVaultSettings(
  db: BusabaseDatabase,
  userId: string | null | undefined,
): Promise<{ success: boolean }> {
  const ownerId = normalizeOwnerId(userId);
  // Clearing the Vault clears what the Vault screen showed. Hidden items are
  // not in that list and have their own management surface (Settings > File
  // Preview), so wiping them here would silently delete a credential the user
  // never saw in the thing they just cleared. Same `preserveHidden` rule as
  // `updateVaultSettings`.
  await db
    .delete(busabaseVaultItems)
    .where(
      and(
        eq(busabaseVaultItems.userId, ownerId),
        notInArray(busabaseVaultItems.key, [...HIDDEN_VAULT_KEYS]),
      ),
    );
  return { success: true };
}

export async function getVaultRuntimeEnv(
  db: BusabaseDatabase,
  userId: string | null | undefined,
): Promise<VaultRuntimeEnv> {
  const ownerId = normalizeOwnerId(userId);
  const settings = toSettingsVO(ownerId, await readVaultRows(db, ownerId));
  return VaultRuntimeEnvSchema.parse(
    Object.fromEntries(
      settings.items
        .filter((item) => item.access.runtime && VaultItemKeySchema.safeParse(item.key).success)
        .map((item) => [item.key, item.value] as const),
    ),
  );
}
