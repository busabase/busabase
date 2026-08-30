import { and, eq } from "drizzle-orm";
import { generateNanoID } from "openlib/nanoid";
import { getContextActorId, getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { decodeVaultValue, encodeVaultValue } from "../../vault/logic/vault-crypto";
import { busabaseVaultItems } from "../../vault/schema/vault-items";

const LEGACY_CONNECTION_KEY = "BUDA_ACP_CONNECTION";
const CONNECTION_KEY_PREFIX = `${LEGACY_CONNECTION_KEY}:`;
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
  slug: string;
  agentId: string;
  agentName: string;
  accessToken: string;
}

export interface BudaConnectionSummary {
  slug: string;
  agentId: string;
  agentName: string;
  ownedByCurrentUser: boolean;
}

export type BudaConnectionScope = "mine" | "space";

const ownerId = () => getContextActorId() ?? "local-user";

const connectionKey = (agentId: string) => `${CONNECTION_KEY_PREFIX}${agentId}`;

export const getBudaSessionSlug = (agentId: string) => `buda:${encodeURIComponent(agentId)}`;

const getAgentIdFromBudaSessionSlug = (slug: string): string | null => {
  if (!slug.startsWith("buda:")) return null;
  try {
    return decodeURIComponent(slug.slice("buda:".length));
  } catch {
    return null;
  }
};

async function readRows(scope: BudaConnectionScope) {
  const database = await getDb();
  const actorId = ownerId();
  const spaceId = getContextSpaceId();
  const rows = await database
    .select()
    .from(busabaseVaultItems)
    .where(
      and(
        eq(busabaseVaultItems.scopeType, "workspace"),
        eq(busabaseVaultItems.scopeId, spaceId),
        ...(scope === "mine" ? [eq(busabaseVaultItems.userId, actorId)] : []),
      ),
    );
  return rows.filter(
    (row) =>
      row.scopeType === "workspace" &&
      row.scopeId === spaceId &&
      (scope === "space" || row.userId === actorId) &&
      (row.key === LEGACY_CONNECTION_KEY || row.key.startsWith(CONNECTION_KEY_PREFIX)),
  );
}

async function readUsableRow(slug: string) {
  const actorId = ownerId();
  const rows = (await readRows("space")).sort(
    (a, b) => Number(b.userId === actorId) - Number(a.userId === actorId),
  );
  if (slug === "buda") {
    return (
      rows.find((row) => row.key === LEGACY_CONNECTION_KEY) ??
      (rows.length === 1 ? rows[0] : undefined)
    );
  }
  const agentId = getAgentIdFromBudaSessionSlug(slug);
  return agentId ? rows.find((row) => row.key === connectionKey(agentId)) : undefined;
}

async function readOwnedRow(slug: string) {
  const rows = await readRows("mine");
  if (slug === "buda") {
    return (
      rows.find((row) => row.key === LEGACY_CONNECTION_KEY) ??
      (rows.length === 1 ? rows[0] : undefined)
    );
  }
  const agentId = getAgentIdFromBudaSessionSlug(slug);
  return agentId ? rows.find((row) => row.key === connectionKey(agentId)) : undefined;
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

export async function saveBudaConnection(connection: StoredBudaConnection): Promise<string> {
  const database = await getDb();
  const rows = await readRows("mine");
  const existing = rows.find((row) => row.key === connectionKey(connection.agentId));
  const legacy = rows.find((row) => row.key === LEGACY_CONNECTION_KEY);
  const legacyConnection = legacy ? parseStored(decodeVaultValue(legacy.valuePayload)) : null;
  const target =
    existing ?? (legacyConnection?.agentId === connection.agentId ? legacy : undefined);
  const valuePayload = encodeVaultValue(JSON.stringify(connection), {
    requireEncryption: getContextActorId() !== undefined,
  });
  if (target) {
    await database
      .update(busabaseVaultItems)
      .set({
        valuePayload,
        description: `Buda ACP: ${connection.agentName}`,
        access: { ...target.access, share: true },
        updatedAt: new Date(),
      })
      .where(eq(busabaseVaultItems.id, target.id));
    return target.key === LEGACY_CONNECTION_KEY ? "buda" : getBudaSessionSlug(connection.agentId);
  }
  await database.insert(busabaseVaultItems).values({
    id: generateNanoID("vlt_", 21),
    userId: ownerId(),
    kind: "secret",
    key: connectionKey(connection.agentId),
    valuePayload,
    scopeType: "workspace",
    scopeId: getContextSpaceId(),
    environment: "production",
    description: `Buda ACP: ${connection.agentName}`,
    access: { runtime: false, reveal: false, edit: false, share: true },
  });
  return getBudaSessionSlug(connection.agentId);
}

async function refresh(
  rowId: string,
  connection: StoredBudaConnection,
): Promise<StoredBudaConnection> {
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
  const database = await getDb();
  await database
    .update(busabaseVaultItems)
    .set({
      valuePayload: encodeVaultValue(JSON.stringify(next), {
        requireEncryption: getContextActorId() !== undefined,
      }),
      description: `Buda ACP: ${next.agentName}`,
      updatedAt: new Date(),
    })
    .where(eq(busabaseVaultItems.id, rowId));
  return next;
}

export async function listBudaConnections(
  scope: BudaConnectionScope = "mine",
): Promise<BudaConnectionSummary[]> {
  const actorId = ownerId();
  const rows = await readRows(scope);
  const byAgentId = new Map<string, BudaConnectionSummary>();
  for (const row of rows) {
    const connection = parseStored(decodeVaultValue(row.valuePayload));
    const summary = {
      slug: row.key === LEGACY_CONNECTION_KEY ? "buda" : getBudaSessionSlug(connection.agentId),
      agentId: connection.agentId,
      agentName: connection.agentName,
      ownedByCurrentUser: row.userId === actorId,
    };
    const current = byAgentId.get(connection.agentId);
    if (
      !current ||
      (summary.ownedByCurrentUser && !current.ownedByCurrentUser) ||
      (summary.ownedByCurrentUser === current.ownedByCurrentUser && summary.slug === "buda")
    ) {
      byAgentId.set(connection.agentId, summary);
    }
  }
  return [...byAgentId.values()];
}

export async function getBudaConnection(slug = "buda"): Promise<BudaConnection | null> {
  const row = await readUsableRow(slug);
  if (!row) return null;
  let connection = parseStored(decodeVaultValue(row.valuePayload));
  if (new Date(connection.expiresAt).getTime() <= Date.now() + 60_000) {
    connection = await refresh(row.id, connection);
  }
  return {
    slug: row.key === LEGACY_CONNECTION_KEY ? "buda" : getBudaSessionSlug(connection.agentId),
    accessToken: connection.accessToken,
    agentId: connection.agentId,
    agentName: connection.agentName,
  };
}

export async function disconnectBuda(slug = "buda"): Promise<boolean> {
  const database = await getDb();
  const row = await readOwnedRow(slug);
  if (!row) return false;

  const connection = parseStored(decodeVaultValue(row.valuePayload));
  const response = await fetch(new URL("/api/oauth/revoke", getBudaOAuthOrigin()), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: connection.refreshToken,
      token_type_hint: "refresh_token",
      client_id: CLIENT_ID,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error("Buda could not revoke this connection. Try again.");
  }

  await database.delete(busabaseVaultItems).where(eq(busabaseVaultItems.id, row.id));
  return true;
}

export function getBudaAcpUrl(agentId: string): string {
  const configuredUrl = process.env.BUDA_ACP_URL?.trim();
  const url = configuredUrl ? new URL(configuredUrl) : new URL("/api/acp", getBudaOAuthOrigin());
  if (!configuredUrl) url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("agentId", agentId);
  return url.toString();
}
