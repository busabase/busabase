import { createHash } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { getContextActorId, getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { decodeVaultValue, encodeVaultValue } from "../../vault/logic/vault-crypto";
import { busabaseVaultItems } from "../../vault/schema/vault-items";

const NAME_KEY_PREFIX = "AGENT_CONNECTION_NAME:";
// Internal records must not enter the editable user Vault or its replace/clear flow.
const INTERNAL_OWNER_PREFIX = "agent-connection-name:";
export const connectionNameOwner = () => getContextActorId() ?? "local-user";
const identity = (ownerId: string, slug: string) => JSON.stringify([ownerId, slug]);

/** Separate metadata survives credential rotation without changing provider identity. */
export async function listConnectionNames(): Promise<Map<string, string>> {
  const database = await getDb();
  const spaceId = getContextSpaceId();
  const rows = await database
    .select()
    .from(busabaseVaultItems)
    .where(
      and(
        eq(busabaseVaultItems.scopeType, "workspace"),
        eq(busabaseVaultItems.scopeId, spaceId),
        like(busabaseVaultItems.key, `${NAME_KEY_PREFIX}%`),
      ),
    );
  const names = new Map<string, string>();
  for (const row of rows) {
    if (
      row.scopeType !== "workspace" ||
      row.scopeId !== spaceId ||
      !row.key.startsWith(NAME_KEY_PREFIX) ||
      !row.userId.startsWith(INTERNAL_OWNER_PREFIX)
    )
      continue;
    const name = decodeVaultValue(row.valuePayload);
    names.set(
      identity(
        row.userId.slice(INTERNAL_OWNER_PREFIX.length),
        row.key.slice(NAME_KEY_PREFIX.length),
      ),
      name,
    );
  }
  return names;
}

export function connectionDisplayName(
  names: Map<string, string>,
  ownerId: string,
  slug: string,
  fallback: string,
): string {
  return names.get(identity(ownerId, slug)) ?? fallback;
}

export async function saveConnectionName(slug: string, name: string): Promise<void> {
  const database = await getDb();
  const actorId = connectionNameOwner();
  const spaceId = getContextSpaceId();
  // The stable id makes concurrent first edits an atomic upsert, not duplicate labels.
  const id = `acn_${createHash("sha256")
    .update(JSON.stringify([actorId, spaceId, slug]))
    .digest("hex")}`;
  const valuePayload = encodeVaultValue(name, {
    requireEncryption: getContextActorId() !== undefined,
  });
  await database
    .insert(busabaseVaultItems)
    .values({
      id,
      userId: `${INTERNAL_OWNER_PREFIX}${actorId}`,
      kind: "variable",
      key: `${NAME_KEY_PREFIX}${slug}`,
      valuePayload,
      scopeType: "workspace",
      scopeId: spaceId,
      environment: "production",
      description: "Agent display name",
      access: { runtime: false, reveal: false, edit: false, share: true },
    })
    .onConflictDoUpdate({
      target: busabaseVaultItems.id,
      set: { valuePayload, updatedAt: new Date() },
    });
}
