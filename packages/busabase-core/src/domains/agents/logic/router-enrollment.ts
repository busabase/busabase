import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gte, lt } from "drizzle-orm";
import { generateNanoID } from "openlib/nanoid";
import { getContextActorId, getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { assertWorkspacePermission } from "../../../logic/node-acl";
import { decodeVaultValue, encodeVaultValue } from "../../vault/logic/vault-crypto";
import { busabaseVaultItems } from "../../vault/schema/vault-items";
import {
  busabaseRouterConnections,
  busabaseRouterPendingEnrollments,
} from "../schema/router-enrollments";
import { busabaseRouterGrants } from "../schema/router-grants";
import { resolveAcprouterEnrollmentOrigin } from "./acprouter-origin-config";
import { getRouterGrantTokens, trustedFetch } from "./router-oauth";

const CONNECTION_SECRET_VAULT_KEY_PREFIX = "ACPROUTER_ROUTER_CONNECTION_SECRET:";
/** Mirrors ACPRouter's own mint-token TTL (`machines-logic.ts`) — the device must bridge within this window. */
const BRIDGE_DEADLINE_MS = 10 * 60 * 1000;
const MINT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_MINTS_PER_WINDOW = 5;

async function activeGrant(grantId: string) {
  const database = await getDb();
  const [grant] = await database
    .select()
    .from(busabaseRouterGrants)
    .where(
      and(
        eq(busabaseRouterGrants.id, grantId),
        eq(busabaseRouterGrants.busabaseSpaceId, getContextSpaceId()),
        eq(busabaseRouterGrants.busabaseActorId, getContextActorId() ?? ""),
      ),
    );
  if (!grant || grant.revokedAt) {
    throw new Error("This ACPRouter connection is no longer authorized.");
  }
  return grant;
}

export async function listRouterGrants() {
  const database = await getDb();
  const rows = await database
    .select()
    .from(busabaseRouterGrants)
    .where(
      and(
        eq(busabaseRouterGrants.busabaseSpaceId, getContextSpaceId()),
        eq(busabaseRouterGrants.busabaseActorId, getContextActorId() ?? ""),
      ),
    );
  return rows
    .filter((row) => !row.revokedAt)
    .map((row) => ({ grantId: row.id, spaceName: row.acprouterSpaceName }));
}

export async function cancelRouterEnrollment(grantId: string, enrollmentId: string) {
  assertWorkspacePermission("write");
  const grant = await activeGrant(grantId);
  const tokens = await getRouterGrantTokens(grant.id, true);
  const response = await trustedFetch(
    new URL("/api/busabase-enrollment/device", resolveAcprouterEnrollmentOrigin()),
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${tokens.refreshToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ enrollmentId }),
    },
  );
  if (!response.ok && response.status !== 404)
    throw new Error("Could not cancel pairing. Retry before generating another command.");
  const database = await getDb();
  await database.transaction(async (tx) => {
    const [connection] = await tx
      .delete(busabaseRouterConnections)
      .where(
        and(
          eq(busabaseRouterConnections.grantId, grant.id),
          eq(busabaseRouterConnections.acprouterEnrollmentId, enrollmentId),
        ),
      )
      .returning();
    if (connection)
      await tx.delete(busabaseVaultItems).where(eq(busabaseVaultItems.id, connection.vaultItemId));
    await tx
      .update(busabaseRouterPendingEnrollments)
      .set({ status: "failed", consumerSecretEncrypted: null, updatedAt: new Date() })
      .where(
        and(
          eq(busabaseRouterPendingEnrollments.grantId, grant.id),
          eq(busabaseRouterPendingEnrollments.acprouterEnrollmentId, enrollmentId),
        ),
      );
  });
  return { ok: true };
}

async function activateLocalConnection(
  grantId: string,
  enrollmentId: string,
  origin: string,
  accessToken: string,
) {
  await sendActivationMarker(origin, accessToken, enrollmentId);
  const database = await getDb();
  await database
    .update(busabaseRouterPendingEnrollments)
    .set({ status: "connected", updatedAt: new Date() })
    .where(
      and(
        eq(busabaseRouterPendingEnrollments.grantId, grantId),
        eq(busabaseRouterPendingEnrollments.acprouterEnrollmentId, enrollmentId),
      ),
    );
}

/**
 * Task 8.7 — per-grant rate limit on enrollment mint. Deliberately reuses the
 * `busabase_router_pending_enrollments` rows `mintRouterEnrollment` itself
 * writes on every successful mint, rather than introducing a dedicated
 * rate-limit table: `busabase-core` is a self-contained workspace package
 * (see `agent-catalog.ts`'s doc comment on why it cannot depend on anything
 * outside this workspace, e.g. `share-domains`'s `verifications` table,
 * which is wired at the app level only) and this data is already exactly
 * "how many mint attempts happened for this grant in the last window" with
 * no extra write. A rejection here happens BEFORE the ACPRouter network call —
 * `mintRouterEnrollment` checks this first and returns without ever reaching
 * `fetch` if the count is at the ceiling.
 */
async function recentMintCountForActor(
  database: Awaited<ReturnType<typeof getDb>>,
  actorId: string,
  now: Date,
): Promise<number> {
  const rows = await database
    .select({ id: busabaseRouterPendingEnrollments.id })
    .from(busabaseRouterPendingEnrollments)
    .innerJoin(
      busabaseRouterGrants,
      eq(busabaseRouterGrants.id, busabaseRouterPendingEnrollments.grantId),
    )
    .where(
      and(
        eq(busabaseRouterGrants.busabaseActorId, actorId),
        gte(
          busabaseRouterPendingEnrollments.createdAt,
          new Date(now.getTime() - MINT_RATE_LIMIT_WINDOW_MS),
        ),
      ),
    );
  return rows.length;
}

interface MintResponse {
  machineId: string;
  enrollmentId: string;
  token: string;
  command: string;
  expiresAt: string;
}

export interface MintRouterEnrollmentResult {
  enrollmentId: string;
  command: string;
  expiresAt: string;
}

/**
 * Task 8.3 — mint an enrollment command for an authorized grant. Never logs
 * `token`/`command` (bearer-equivalent secrets passed straight through to the
 * caller's response payload only).
 */
export async function mintRouterEnrollment(
  grantId: string,
  intendedAgentSlug = "claude-acp",
): Promise<MintRouterEnrollmentResult> {
  if (intendedAgentSlug !== "claude-acp" && intendedAgentSlug !== "codex-acp") {
    throw new Error("Choose Claude Code or Codex.");
  }
  assertWorkspacePermission("write");
  const actorId = getContextActorId();
  if (!actorId) throw new Error("Sign in to Busabase first.");

  const grant = await activeGrant(grantId);
  const tokens = await getRouterGrantTokens(grant.id);
  const database = await getDb();
  return database.transaction(async (tx) => {
    // All grants owned by this actor share the same lock order, so changing
    // workspaces/grants or racing workers cannot bypass the actor's limit.
    await tx
      .select({ id: busabaseRouterGrants.id })
      .from(busabaseRouterGrants)
      .where(eq(busabaseRouterGrants.busabaseActorId, actorId))
      .orderBy(busabaseRouterGrants.id)
      .for("update");
    if (
      (await recentMintCountForActor(tx as unknown as typeof database, actorId, new Date())) >=
      MAX_MINTS_PER_WINDOW
    ) {
      throw new Error("Too many enrollment attempts. Wait a moment and try again.");
    }
    const acprouterOrigin = resolveAcprouterEnrollmentOrigin();
    const response = await trustedFetch(new URL("/api/busabase-enrollment/mint", acprouterOrigin), {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(intendedAgentSlug ? { intendedAgentSlug } : {}),
    });
    if (!response.ok) throw new Error("ACPRouter rejected the enrollment mint request.");
    const body = (await response.json()) as Partial<MintResponse>;
    if (
      typeof body.enrollmentId !== "string" ||
      typeof body.token !== "string" ||
      typeof body.command !== "string" ||
      typeof body.expiresAt !== "string"
    ) {
      throw new Error("ACPRouter returned an incomplete enrollment mint response.");
    }

    const now = new Date();
    await tx
      .insert(busabaseRouterPendingEnrollments)
      .values({
        id: generateNanoID("rpe_", 21),
        grantId: grant.id,
        acprouterEnrollmentId: body.enrollmentId,
        status: "pending",
        bridgeDeadlineAt: new Date(now.getTime() + BRIDGE_DEADLINE_MS),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          busabaseRouterPendingEnrollments.grantId,
          busabaseRouterPendingEnrollments.acprouterEnrollmentId,
        ],
      });

    return { enrollmentId: body.enrollmentId, command: body.command, expiresAt: body.expiresAt };
  });
}

export type RouterEnrollmentStatus =
  | { state: "not_redeemed" }
  | { state: "redeemed_offline"; machineId: string }
  | { state: "online"; machineId: string }
  | { state: "failed"; machineId: string };

/** Task 8.4 — poll ACPRouter's enrollment status for a given grant+enrollment pair. */
export async function pollRouterEnrollmentStatus(
  grantId: string,
  enrollmentId: string,
): Promise<RouterEnrollmentStatus> {
  assertWorkspacePermission("read");
  const grant = await activeGrant(grantId);
  const tokens = await getRouterGrantTokens(grant.id);
  const acprouterOrigin = resolveAcprouterEnrollmentOrigin();
  const statusUrl = new URL("/api/busabase-enrollment/status", acprouterOrigin);
  statusUrl.searchParams.set("enrollmentId", enrollmentId);
  const response = await trustedFetch(statusUrl, {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
  });
  if (!response.ok) throw new Error("ACPRouter rejected the enrollment status request.");
  const body = (await response.json()) as Partial<RouterEnrollmentStatus>;
  if (body.state === "not_redeemed") return { state: "not_redeemed" };
  if (
    (body.state === "redeemed_offline" || body.state === "online" || body.state === "failed") &&
    typeof body.machineId === "string"
  ) {
    return { state: body.state, machineId: body.machineId };
  }
  throw new Error("ACPRouter returned an invalid enrollment status response.");
}

interface CompleteResponse {
  outcome: "registered" | "already_registered";
  agentId: string;
  connectionUrl: string;
  key: { id: string; label: string };
}

export interface RegisterRouterConnectionResult {
  connectionSlug: string;
  agentSlug: string;
}

/**
 * Completion-activation marker (tasks.md "Completion activation and expiry
 * clarification") — tells ACPRouter the local vault commit for this
 * enrollment has durably landed, which permanently exempts it from
 * `cleanupAbandonedEnrollmentCompletions`'s 10-minute sweep regardless of
 * bridge state. ACPRouter's own `activateEnrollmentCompletion` is idempotent
 * on `(grantId, enrollmentId)` (a second call is a no-op, same outcome), so
 * this is safe to call again on any retry — including a retry that lands on
 * `registerRouterConnection`'s already-committed short-circuit paths, which
 * is exactly the "activation response lost after the local commit" case this
 * must survive. Failure remains incomplete and retryable: the committed
 * connection cannot launch until activation is confirmed.
 */
async function sendActivationMarker(
  acprouterOrigin: string,
  accessToken: string,
  enrollmentId: string,
): Promise<void> {
  const response = await trustedFetch(
    new URL("/api/busabase-enrollment/activate", acprouterOrigin),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ enrollmentId }),
    },
  );
  if (!response.ok)
    throw new Error("Pairing activation is incomplete. Retry to finish connecting.");
}

/**
 * Task 8.5 — generate the one consumer secret for this enrollment (atomic
 * pending-row claim, same `secret_claimed` state the schema's doc comment
 * describes), persist it encrypted BEFORE any HTTP call, then register its
 * hash with ACPRouter and commit the stable connection+vault row.
 *
 * Recoverable at every step: if this crashes after claiming the secret but
 * before registering the hash, a retry reuses the SAME encrypted secret
 * (never mints a second one), so ACPRouter's idempotent same-hash retry path
 * is what actually runs. If it crashes after registering but before the
 * connection row commits, a retry's `already_registered` response still
 * carries the same `agentId`, so the connection row that gets written on
 * retry is identical to what the first attempt would have written.
 */
export async function registerRouterConnection(
  grantId: string,
  enrollmentId: string,
  agentSlug: string,
): Promise<RegisterRouterConnectionResult> {
  assertWorkspacePermission("write");
  const grant = await activeGrant(grantId);
  const database = await getDb();
  const acprouterOrigin = resolveAcprouterEnrollmentOrigin();

  const [existingConnection] = await database
    .select()
    .from(busabaseRouterConnections)
    .where(
      and(
        eq(busabaseRouterConnections.grantId, grant.id),
        eq(busabaseRouterConnections.acprouterEnrollmentId, enrollmentId),
      ),
    );
  if (existingConnection) {
    if (existingConnection.pendingRevokedAt) throw new Error("This device is being disconnected.");
    const tokens = await getRouterGrantTokens(grant.id);
    await activateLocalConnection(grant.id, enrollmentId, acprouterOrigin, tokens.accessToken);
    return {
      connectionSlug: `acprouter:${existingConnection.id}`,
      agentSlug: existingConnection.agentSlug,
    };
  }

  const [pending] = await database
    .select()
    .from(busabaseRouterPendingEnrollments)
    .where(
      and(
        eq(busabaseRouterPendingEnrollments.grantId, grant.id),
        eq(busabaseRouterPendingEnrollments.acprouterEnrollmentId, enrollmentId),
      ),
    );
  if (!pending) throw new Error("Start the enrollment before completing it.");
  if (pending.status === "failed") throw new Error("This pairing expired. Generate a new command.");

  let rawSecret: string;
  if (pending.consumerSecretEncrypted) {
    rawSecret = decodeVaultValue(JSON.parse(pending.consumerSecretEncrypted));
  } else {
    rawSecret = randomBytes(32).toString("base64url");
    const encrypted = encodeVaultValue(rawSecret, {
      requireEncryption: getContextActorId() !== undefined,
    });
    const [claimed] = await database
      .update(busabaseRouterPendingEnrollments)
      .set({
        status: "secret_claimed",
        consumerSecretEncrypted: JSON.stringify(encrypted),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(busabaseRouterPendingEnrollments.id, pending.id),
          eq(busabaseRouterPendingEnrollments.status, "pending"),
        ),
      )
      .returning();
    if (!claimed) {
      // Lost the claim race — re-read whatever the winner wrote and reuse it.
      const [refreshed] = await database
        .select()
        .from(busabaseRouterPendingEnrollments)
        .where(eq(busabaseRouterPendingEnrollments.id, pending.id));
      if (!refreshed?.consumerSecretEncrypted) {
        throw new Error("This enrollment is already being completed. Try again.");
      }
      rawSecret = decodeVaultValue(JSON.parse(refreshed.consumerSecretEncrypted));
    }
  }

  const consumerKeyHash = createHash("sha256").update(rawSecret).digest("hex");
  const tokens = await getRouterGrantTokens(grant.id);
  const response = await trustedFetch(
    new URL("/api/busabase-enrollment/complete", acprouterOrigin),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ enrollmentId, consumerKeyHash }),
    },
  );
  if (response.status === 409) {
    throw new Error("The agent has not finished bridging yet. Try again shortly.");
  }
  if (!response.ok) throw new Error("ACPRouter rejected the enrollment completion request.");
  const body = (await response.json()) as Partial<CompleteResponse>;
  if (
    (body.outcome !== "registered" && body.outcome !== "already_registered") ||
    typeof body.agentId !== "string" ||
    typeof body.connectionUrl !== "string"
  ) {
    throw new Error("ACPRouter returned an incomplete enrollment completion response.");
  }

  const [existingByAgent] = await database
    .select()
    .from(busabaseRouterConnections)
    .where(
      and(
        eq(busabaseRouterConnections.grantId, grant.id),
        eq(busabaseRouterConnections.acprouterEnrollmentId, enrollmentId),
      ),
    );
  if (existingByAgent) {
    await activateLocalConnection(grant.id, enrollmentId, acprouterOrigin, tokens.accessToken);
    return {
      connectionSlug: `acprouter:${existingByAgent.id}`,
      agentSlug: existingByAgent.agentSlug,
    };
  }

  const vaultItemId = generateNanoID("vlt_", 21);
  const confirmedAgentId = body.agentId;
  await database.transaction(async (tx) => {
    // Serialize concurrent completions on the pending row before writing either vault or connection.
    await tx
      .update(busabaseRouterPendingEnrollments)
      .set({ updatedAt: new Date() })
      .where(eq(busabaseRouterPendingEnrollments.id, pending.id));
    const [winner] = await tx
      .select()
      .from(busabaseRouterConnections)
      .where(
        and(
          eq(busabaseRouterConnections.grantId, grant.id),
          eq(busabaseRouterConnections.acprouterEnrollmentId, enrollmentId),
        ),
      );
    if (winner) return;
    await tx.insert(busabaseVaultItems).values({
      id: vaultItemId,
      userId: getContextActorId() ?? "local-user",
      kind: "secret",
      key: `${CONNECTION_SECRET_VAULT_KEY_PREFIX}${enrollmentId}`,
      valuePayload: encodeVaultValue(
        JSON.stringify({ secret: rawSecret, url: body.connectionUrl }),
        {
          requireEncryption: getContextActorId() !== undefined,
        },
      ),
      scopeType: "workspace",
      scopeId: grant.busabaseSpaceId,
      environment: "production",
      description: `ACPRouter agent: ${agentSlug}`,
      access: { runtime: false, reveal: false, edit: false, share: false },
    });

    const connectionId = generateNanoID("rcn_", 21);
    await tx
      .insert(busabaseRouterConnections)
      .values({
        id: connectionId,
        grantId: grant.id,
        acprouterEnrollmentId: enrollmentId,
        acprouterAgentId: confirmedAgentId,
        agentSlug,
        vaultItemId,
        createdAt: new Date(),
      })
      .onConflictDoNothing({
        target: [
          busabaseRouterConnections.grantId,
          busabaseRouterConnections.acprouterEnrollmentId,
        ],
      });

    await tx
      .update(busabaseRouterPendingEnrollments)
      .set({ status: "registered", acprouterAgentId: body.agentId, updatedAt: new Date() })
      .where(eq(busabaseRouterPendingEnrollments.id, pending.id));
  });

  const [finalConnection] = await database
    .select()
    .from(busabaseRouterConnections)
    .where(
      and(
        eq(busabaseRouterConnections.grantId, grant.id),
        eq(busabaseRouterConnections.acprouterEnrollmentId, enrollmentId),
      ),
    );
  if (!finalConnection) throw new Error("Failed to persist the ACPRouter connection.");
  await activateLocalConnection(grant.id, enrollmentId, acprouterOrigin, tokens.accessToken);
  return {
    connectionSlug: `acprouter:${finalConnection.id}`,
    agentSlug: finalConnection.agentSlug,
  };
}

/** Housekeeping: abandon pending enrollments that never bridged within their deadline. */
export async function cleanupAbandonedRouterEnrollments(now = new Date()): Promise<number> {
  const database = await getDb();
  const abandoned = await database
    .update(busabaseRouterPendingEnrollments)
    .set({ status: "failed", updatedAt: now })
    .where(
      and(
        eq(busabaseRouterPendingEnrollments.status, "pending"),
        lt(busabaseRouterPendingEnrollments.bridgeDeadlineAt, now),
      ),
    )
    .returning();
  return abandoned.length;
}
