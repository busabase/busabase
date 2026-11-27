import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
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

// Server-only consumers may resolve a selected payload without loading the entire Vault.
export { decodeVaultValue, encodeVaultValue } from "./vault-crypto";

type VaultItemRow = typeof busabaseVaultItems.$inferSelect;

type VaultMutationOptions = {
  // Server callers must authorize the owner's scope before bypassing item policy.
  // This option is deliberately absent from the public input schema.
  bypassItemEditPolicy?: boolean;
};

const normalizeOwnerId = (userId: string | null | undefined) => userId?.trim() ?? "";

const createVaultItemId = () => `vault_${randomUUID()}`;

const defaultVaultAccess = {
  runtime: true,
  reveal: true,
  edit: true,
  share: false,
};

const INTERNAL_VAULT_KEYS = [
  PREVIEWFILE_API_KEY,
  "BUDA_ACP_CONNECTION",
  "ACPROUTER_ROUTER_GRANT_TOKEN",
  "ACPROUTER_ROUTER_CONNECTION_SECRET",
] as const;

export function isUserManageableVaultKey(key: string): boolean {
  // The schema currently rejects ":"; keep the reserved-prefix guard if that
  // format is ever relaxed, so internal connection keys remain protected.
  return (
    VaultItemKeySchema.safeParse(key).success &&
    !INTERNAL_VAULT_KEYS.some((reserved) => key === reserved || key.startsWith(`${reserved}:`))
  );
}

const itemIdentity = (item: {
  environment: string;
  scopeType: string;
  scopeId?: string | null;
  key: string;
}) => JSON.stringify([item.environment, item.scopeType, item.scopeId ?? null, item.key]);

function normalizeItem(input: VaultItemInput): VaultItemInput {
  return VaultItemInputSchema.parse({
    ...input,
    id: input.id?.trim() || undefined,
    key: input.key.trim().toUpperCase(),
    scopeId: input.scopeId?.trim() || null,
    description: input.description?.trim() ?? "",
    access: VaultAccessPolicySchema.parse(input.access ?? defaultVaultAccess),
  });
}

function normalizeItems(rawItems: unknown): VaultItemInput[] {
  const { items } = UpdateVaultSettingsInputSchema.parse({ items: rawItems });
  const identities = new Set<string>();
  const ids = new Set<string>();
  const normalized = items.map(normalizeItem);
  for (const item of normalized) {
    if (!isUserManageableVaultKey(item.key)) {
      throw new ORPCError("BAD_REQUEST", { message: "This Vault key is managed by the system." });
    }
    const identity = itemIdentity(item);
    if (identities.has(identity) || (item.id && ids.has(item.id))) {
      throw new ORPCError("BAD_REQUEST", { message: "Duplicate Vault items are not allowed." });
    }
    identities.add(identity);
    if (item.id) ids.add(item.id);
  }
  return normalized;
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

export async function getVaultSettings(
  db: BusabaseDatabase,
  userId: string | null | undefined,
): Promise<VaultSettingsVO> {
  const ownerId = normalizeOwnerId(userId);
  const rows = await readVaultRows(db, ownerId);
  return toSettingsVO(
    ownerId,
    rows.filter((row) => isUserManageableVaultKey(row.key)),
  );
}

export async function updateVaultSettings(
  db: BusabaseDatabase,
  userId: string | null | undefined,
  input: { items: unknown[] },
  options: VaultMutationOptions & { requireEncryption?: boolean } = {},
): Promise<VaultSettingsVO> {
  const ownerId = normalizeOwnerId(userId);
  const items = normalizeItems(input.items);
  return db.transaction(async (tx) => {
    const current = (await readVaultRows(tx, ownerId)).filter((row) =>
      isUserManageableVaultKey(row.key),
    );
    const byId = new Map(current.map((row) => [row.id, row]));
    const byIdentity = new Map(current.map((row) => [itemIdentity(row), row]));
    const now = new Date();
    const prepared = items.map((item) => {
      const existing = item.id ? byId.get(item.id) : byIdentity.get(itemIdentity(item));
      if (
        item.id &&
        (!existing ||
          existing.environment !== item.environment ||
          existing.scopeType !== item.scopeType ||
          (existing.scopeId ?? null) !== (item.scopeId ?? null))
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "The Vault item does not belong to this scope. Reload before saving.",
        });
      }
      const occupied = byIdentity.get(itemIdentity(item));
      if (existing && occupied && occupied.id !== existing.id) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Another Vault item already uses this key in this scope.",
        });
      }
      if (existing) {
        const unchanged =
          item.key === existing.key &&
          item.kind === existing.kind &&
          item.value === decodeVaultValue(existing.valuePayload) &&
          item.description === existing.description &&
          Object.entries(existing.access).every(
            ([capability, allowed]) =>
              item.access[capability as keyof typeof item.access] === allowed,
          );
        if (unchanged) {
          // Full-snapshot saves must preserve ciphertext and updatedAt: Site revisions use it.
          return { existing, row: existing, skipWrite: true };
        }
        if (!existing.access.edit && !options.bypassItemEditPolicy) {
          throw new ORPCError("FORBIDDEN", {
            message: "Edit access is disabled for this Vault item.",
          });
        }
      }
      return {
        existing,
        skipWrite: false,
        row: {
          id: existing?.id ?? createVaultItemId(),
          userId: ownerId,
          kind: item.kind,
          key: item.key,
          valuePayload:
            existing &&
            (existing.valuePayload.encoding === "encrypted" || !options.requireEncryption) &&
            item.value === decodeVaultValue(existing.valuePayload)
              ? existing.valuePayload
              : encodeVaultValue(item.value, options),
          scopeType: item.scopeType,
          scopeId: item.scopeId ?? null,
          environment: item.environment,
          description: item.description,
          access: item.access,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          lastUsedAt: existing?.lastUsedAt ?? null,
        },
      };
    });
    const keptIds = new Set(prepared.map(({ row }) => row.id));
    if (keptIds.size !== prepared.length) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Multiple inputs cannot update the same Vault item.",
      });
    }
    // Unless the server authorized a scope-level bypass, an omitted locked row
    // is preserved even when a client never received that row.
    const removedIds = current
      .filter((row) => (options.bypassItemEditPolicy || row.access.edit) && !keptIds.has(row.id))
      .map((row) => row.id);
    if (removedIds.length > 0) {
      await tx
        .delete(busabaseVaultItems)
        .where(
          and(eq(busabaseVaultItems.userId, ownerId), inArray(busabaseVaultItems.id, removedIds)),
        );
    }
    for (const { existing, skipWrite, row } of prepared) {
      if (skipWrite) continue;
      if (existing) {
        const {
          id,
          userId: _userId,
          createdAt: _createdAt,
          lastUsedAt: _lastUsedAt,
          ...patch
        } = row;
        await tx
          .update(busabaseVaultItems)
          .set(patch)
          .where(and(eq(busabaseVaultItems.userId, ownerId), eq(busabaseVaultItems.id, id)));
      } else {
        await tx.insert(busabaseVaultItems).values(row);
      }
    }
    return getVaultSettings(tx, ownerId);
  });
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
  const valuePayload = apiKey === null ? null : encodeVaultValue(apiKey);
  return db.transaction(async (tx) => {
    const predicate = and(
      eq(busabaseVaultItems.userId, ownerId),
      eq(busabaseVaultItems.key, PREVIEWFILE_API_KEY),
    );
    const [existing] = await tx.select().from(busabaseVaultItems).where(predicate);
    if (valuePayload === null) {
      await tx.delete(busabaseVaultItems).where(predicate);
    } else if (existing) {
      await tx
        .update(busabaseVaultItems)
        .set({ valuePayload, updatedAt: new Date() })
        .where(predicate);
    } else {
      await tx.insert(busabaseVaultItems).values({
        id: createVaultItemId(),
        userId: ownerId,
        kind: "secret",
        key: PREVIEWFILE_API_KEY,
        valuePayload,
        scopeType: "personal",
        scopeId: null,
        environment: "local",
        description: "PreviewFile API key for Drive file previews",
        access: { runtime: true, reveal: false, edit: true, share: false },
      });
    }
    return { success: true };
  });
}

export async function clearVaultSettings(
  db: BusabaseDatabase,
  userId: string | null | undefined,
  options: VaultMutationOptions = {},
): Promise<{ success: boolean }> {
  const ownerId = normalizeOwnerId(userId);
  return db.transaction(async (tx) => {
    const items = (await readVaultRows(tx, ownerId)).filter((row) =>
      isUserManageableVaultKey(row.key),
    );
    if (!options.bypassItemEditPolicy && items.some((row) => !row.access.edit)) {
      throw new ORPCError("FORBIDDEN", {
        message: "The Vault contains items with edit access disabled. Clear was cancelled.",
      });
    }
    if (items.length > 0) {
      await tx.delete(busabaseVaultItems).where(
        and(
          eq(busabaseVaultItems.userId, ownerId),
          inArray(
            busabaseVaultItems.id,
            items.map((row) => row.id),
          ),
        ),
      );
    }
    return { success: true };
  });
}

export async function getVaultRuntimeEnv(
  db: BusabaseDatabase,
  userId: string | null | undefined,
): Promise<VaultRuntimeEnv> {
  const ownerId = normalizeOwnerId(userId);
  const rows = (await readVaultRows(db, ownerId)).filter(
    (row) =>
      row.access.runtime && (isUserManageableVaultKey(row.key) || row.key === PREVIEWFILE_API_KEY),
  );
  const settings = toSettingsVO(ownerId, rows);
  return VaultRuntimeEnvSchema.parse(
    Object.fromEntries(settings.items.map((item) => [item.key, item.value] as const)),
  );
}
