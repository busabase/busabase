/**
 * Cloud Connect local state — DB access for the single `busabase_cloud_connect`
 * row (this local instance's stable `tunnelId`, configured Cloud URL, and — once
 * connected — the resource-bound OAuth token set). Every function takes `db`
 * as its first argument (server-only; funnels all access here per the domain's
 * DDD convention). No React/Next imports — safe to call from route handlers,
 * `instrumentation.node.ts`, and the relay client module alike.
 */
import "server-only";
import type { BusabaseDatabase as Database } from "busabase-core/context";
import { eq } from "drizzle-orm";
import { generateNanoID } from "openlib/nanoid";
import {
  type BusabaseCloudConnectRow,
  busabaseCloudConnect,
  CLOUD_CONNECT_ROW_ID,
} from "../schema/cloud-connect";

/** Official production Cloud, editable in Settings for self-hosted deployments. */
export const DEFAULT_CLOUD_URL = "https://busabase.com";

export async function getCloudConnectRow(db: Database): Promise<BusabaseCloudConnectRow | null> {
  const [row] = await db
    .select()
    .from(busabaseCloudConnect)
    .where(eq(busabaseCloudConnect.id, CLOUD_CONNECT_ROW_ID))
    .limit(1);
  return row ?? null;
}

/**
 * Get-or-create the singleton row. The `tunnelId` is generated exactly once —
 * this is the "stable local identifier" the OAuth spec (§5a) requires exist
 * BEFORE the connect flow starts, so the minted credential is scoped to it from
 * birth.
 */
export async function ensureCloudConnectRow(db: Database): Promise<BusabaseCloudConnectRow> {
  const existing = await getCloudConnectRow(db);
  if (existing) return existing;

  const now = new Date();
  const [created] = await db
    .insert(busabaseCloudConnect)
    .values({
      id: CLOUD_CONNECT_ROW_ID,
      tunnelId: generateNanoID("tnl_", 21),
      cloudUrl: DEFAULT_CLOUD_URL,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: busabaseCloudConnect.id })
    .returning();

  // Lost the insert race (e.g. concurrent first requests) — read back the row
  // the other caller created rather than erroring.
  if (created) return created;
  const row = await getCloudConnectRow(db);
  if (!row) throw new Error("Failed to create or read the Cloud Connect row.");
  return row;
}

export async function setCloudUrl(
  db: Database,
  cloudUrl: string,
): Promise<BusabaseCloudConnectRow> {
  await ensureCloudConnectRow(db);
  const [updated] = await db
    .update(busabaseCloudConnect)
    .set({ cloudUrl, updatedAt: new Date() })
    .where(eq(busabaseCloudConnect.id, CLOUD_CONNECT_ROW_ID))
    .returning();
  return updated;
}

export interface SaveCredentialInput {
  token: string;
  refreshToken: string;
  expiresAt: Date;
  /** The origin (scheme+host+port) this OSS server was reached at — needed to
   *  resume the relay client on a later boot, when there's no request to read
   *  it from. */
  ossOrigin: string;
}

export async function saveCloudConnectCredential(
  db: Database,
  input: SaveCredentialInput,
): Promise<BusabaseCloudConnectRow> {
  await ensureCloudConnectRow(db);
  const [updated] = await db
    .update(busabaseCloudConnect)
    .set({
      credentialToken: input.token,
      credentialRefreshToken: input.refreshToken,
      credentialExpiresAt: input.expiresAt,
      ossOrigin: input.ossOrigin,
      updatedAt: new Date(),
    })
    .where(eq(busabaseCloudConnect.id, CLOUD_CONNECT_ROW_ID))
    .returning();
  return updated;
}

/** Disconnect: clear the credential but keep the stable tunnelId + cloudUrl. */
export async function clearCloudConnectCredential(db: Database): Promise<void> {
  await db
    .update(busabaseCloudConnect)
    .set({
      credentialToken: null,
      credentialRefreshToken: null,
      credentialExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(busabaseCloudConnect.id, CLOUD_CONNECT_ROW_ID));
}
