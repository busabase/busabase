import { and, eq } from "drizzle-orm";
import { generateNanoID } from "openlib/nanoid";
import { getContextActorId, getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { decodeVaultValue, encodeVaultValue } from "../../vault/logic/vault-crypto";
import { busabaseVaultItems } from "../../vault/schema/vault-items";

const CONNECTION_KEY = "BUDA_ACP_CONNECTION";
const DEFAULT_BUDA_ORIGIN = "https://dev.buda.im";
const CLIENT_ID = "busabase-cloud";

export function getBudaOAuthOrigin(): string {
  return new URL(process.env.BUDA_OAUTH_ORIGIN?.trim() || DEFAULT_BUDA_ORIGIN).origin;
}

export interface StoredBudaConnection {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  agentId: string;
  agentName: string;
}

export interface BudaConnection {
  agentId: string;
  agentName: string;
  accessToken: string;
}

const ownerId = () => getContextActorId() ?? "local-user";

async function readRow() {
  const database = await getDb();
  const [row] = await database
    .select()
    .from(busabaseVaultItems)
    .where(
      and(
        eq(busabaseVaultItems.userId, ownerId()),
        eq(busabaseVaultItems.key, CONNECTION_KEY),
        eq(busabaseVaultItems.scopeType, "workspace"),
        eq(busabaseVaultItems.scopeId, getContextSpaceId()),
      ),
    )
    .limit(1);
  return row;
}

function parseStored(value: string): StoredBudaConnection {
  const parsed = JSON.parse(value) as Partial<StoredBudaConnection>;
  if (
    typeof parsed.accessToken !== "string" ||
    typeof parsed.refreshToken !== "string" ||
    typeof parsed.expiresAt !== "string" ||
    typeof parsed.agentId !== "string" ||
    typeof parsed.agentName !== "string"
  ) {
    throw new Error("Saved Buda connection is invalid. Reconnect Buda to continue.");
  }
  return parsed as StoredBudaConnection;
}

export async function saveBudaConnection(connection: StoredBudaConnection): Promise<void> {
  const database = await getDb();
  const existing = await readRow();
  const valuePayload = encodeVaultValue(JSON.stringify(connection), {
    requireEncryption: getContextActorId() !== undefined,
  });
  if (existing) {
    await database
      .update(busabaseVaultItems)
      .set({
        valuePayload,
        description: `Buda ACP: ${connection.agentName}`,
        updatedAt: new Date(),
      })
      .where(eq(busabaseVaultItems.id, existing.id));
    return;
  }
  await database.insert(busabaseVaultItems).values({
    id: generateNanoID("vlt_", 21),
    userId: ownerId(),
    kind: "secret",
    key: CONNECTION_KEY,
    valuePayload,
    scopeType: "workspace",
    scopeId: getContextSpaceId(),
    environment: "production",
    description: `Buda ACP: ${connection.agentName}`,
    access: { runtime: true, reveal: false, edit: false, share: false },
  });
}

async function refresh(connection: StoredBudaConnection): Promise<StoredBudaConnection> {
  const budaOrigin = getBudaOAuthOrigin();
  const response = await fetch(new URL("/api/oauth/token", budaOrigin), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
      client_id: CLIENT_ID,
      resource: new URL("/api/acp", budaOrigin).toString(),
    }),
  });
  if (!response.ok) throw new Error("Buda authorization expired. Reconnect Buda to continue.");
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    agent_id?: string;
    agent_name?: string;
  };
  if (!body.access_token || !body.refresh_token || typeof body.expires_in !== "number") {
    throw new Error("Buda returned an invalid refreshed credential.");
  }
  const next = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
    agentId: body.agent_id || connection.agentId,
    agentName: body.agent_name || connection.agentName,
  };
  await saveBudaConnection(next);
  return next;
}

export async function getBudaConnection(): Promise<BudaConnection | null> {
  const row = await readRow();
  if (!row) return null;
  let connection = parseStored(decodeVaultValue(row.valuePayload));
  if (new Date(connection.expiresAt).getTime() <= Date.now() + 60_000) {
    connection = await refresh(connection);
  }
  return {
    accessToken: connection.accessToken,
    agentId: connection.agentId,
    agentName: connection.agentName,
  };
}

export async function disconnectBuda(): Promise<void> {
  const database = await getDb();
  const row = await readRow();
  if (row) await database.delete(busabaseVaultItems).where(eq(busabaseVaultItems.id, row.id));
}

export function getBudaAcpUrl(agentId: string): string {
  const configuredUrl = process.env.BUDA_ACP_URL?.trim();
  const url = configuredUrl ? new URL(configuredUrl) : new URL("/api/acp", getBudaOAuthOrigin());
  if (!configuredUrl) url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("agentId", agentId);
  return url.toString();
}
