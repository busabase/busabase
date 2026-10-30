import "server-only";

import type { AgentConnectionDetailVO } from "busabase-contract/domains/agents/types";
import { and, eq } from "drizzle-orm";
import { getContextActorId, getContextSpaceId, resolveUserRefs } from "../../../context";
import { getDb } from "../../../db";
import { decodeVaultValue } from "../../vault/logic/vault-crypto";
import { busabaseVaultItems } from "../../vault/schema/vault-items";
import {
  busabaseRouterConnections,
  busabaseRouterPendingEnrollments,
} from "../schema/router-enrollments";
import { busabaseRouterGrants } from "../schema/router-grants";
import { resolveAcprouterEnrollmentOrigin } from "./acprouter-origin-config";
import {
  connectionDisplayName,
  connectionNameOwner,
  listConnectionNames,
} from "./agent-connection-name";
import { getRouterGrantTokens, trustedFetch } from "./router-oauth";

export interface RouterConnectionLaunch {
  url: string;
  authHeader: string;
}

interface StoredConnectionSecret {
  secret: string;
  url: string;
}

const connectionSlugPrefix = "acprouter:";

export const getRouterConnectionSlug = (connectionId: string) =>
  `${connectionSlugPrefix}${connectionId}`;

export async function getRouterConnectionDetail(
  slug: string,
): Promise<AgentConnectionDetailVO | null> {
  const found = await readConnectionRow(slug);
  if (!found) return null;
  const database = await getDb();
  const [pending] = await database
    .select()
    .from(busabaseRouterPendingEnrollments)
    .where(
      and(
        eq(busabaseRouterPendingEnrollments.grantId, found.grant.id),
        eq(
          busabaseRouterPendingEnrollments.acprouterEnrollmentId,
          found.connection.acprouterEnrollmentId,
        ),
      ),
    );
  // The grant's own `busabaseActorId` is the connector — not the viewer.
  // `readConnectionRow` currently only ever returns a grant owned by the
  // caller (see its query), so this resolves to the viewer today, but it is
  // the honest, non-inferred source rather than a `getContextActorId()`
  // shortcut that would silently stop being true if that filter ever loosens.
  const connectedBy =
    (await resolveUserRefs([found.grant.busabaseActorId])).get(found.grant.busabaseActorId) ?? null;
  return {
    slug,
    agentName: connectionDisplayName(
      await listConnectionNames(),
      connectionNameOwner(),
      slug,
      found.connection.agentSlug,
    ),
    provider: "acprouter",
    providerAgentName: found.connection.agentSlug,
    agentId: found.connection.acprouterAgentId,
    transport: "remote-websocket",
    status: found.grant.revokedAt
      ? "revoked"
      : found.connection.pendingRevokedAt
        ? "disconnecting"
        : pending?.status === "connected"
          ? "saved"
          : "activating",
    ownedByCurrentUser: true,
    connectedBy,
    routerWorkspaceName: found.grant.acprouterSpaceName,
    routerWorkspaceId: found.grant.acprouterSpaceId,
    deviceId: found.connection.acprouterEnrollmentId,
  };
}

/** Block launches before any potentially slow session shutdown/network work. */
export async function beginRouterConnectionDisconnect(slug: string): Promise<void> {
  const found = await readConnectionRow(slug);
  if (!found) throw new Error("This ACPRouter agent is not connected.");
  const database = await getDb();
  await database
    .update(busabaseRouterConnections)
    .set({ pendingRevokedAt: new Date() })
    .where(eq(busabaseRouterConnections.id, found.connection.id));
}

const getConnectionIdFromSlug = (slug: string): string | null =>
  slug.startsWith(connectionSlugPrefix) ? slug.slice(connectionSlugPrefix.length) : null;

/** The trusted `wss://`/`ws://` origin ACPRouter's own connection URLs must resolve to. */
function trustedConsumerWsOrigin(): string {
  return resolveAcprouterEnrollmentOrigin().replace(/^http/, "ws");
}

async function readConnectionRow(slug: string) {
  const connectionId = getConnectionIdFromSlug(slug);
  if (!connectionId) return null;
  const database = await getDb();
  const [connection] = await database
    .select()
    .from(busabaseRouterConnections)
    .where(eq(busabaseRouterConnections.id, connectionId));
  if (!connection) return null;
  const [grant] = await database
    .select()
    .from(busabaseRouterGrants)
    .where(
      and(
        eq(busabaseRouterGrants.id, connection.grantId),
        eq(busabaseRouterGrants.busabaseSpaceId, getContextSpaceId()),
        eq(busabaseRouterGrants.busabaseActorId, getContextActorId() ?? ""),
      ),
    );
  if (!grant) return null;
  return { connection, grant };
}

/**
 * Task 8.6, tenant-scoping fix (post-draft review) — pushes the space
 * predicate into the SQL join itself instead of loading every tenant's
 * connections and filtering in JS. The prior shape (`select().from(...)`
 * with no `WHERE` at all, then an in-memory `Set.has` filter) scaled with
 * the TOTAL number of connections across every space on the deployment, not
 * just this one — a correctness non-issue at small scale, but a real
 * tenant-isolation smell (every row briefly exists in this process's memory
 * regardless of which space asked) and a real scaling problem.
 */
export async function listRouterConnections(): Promise<
  {
    slug: string;
    agentSlug: string;
    agentName: string;
    grantId: string;
    connectionState: "ready" | "activating" | "disconnecting";
  }[]
> {
  const database = await getDb();
  const spaceId = getContextSpaceId();
  const connections = await database
    .select({
      id: busabaseRouterConnections.id,
      agentSlug: busabaseRouterConnections.agentSlug,
      grantId: busabaseRouterConnections.grantId,
      pendingRevokedAt: busabaseRouterConnections.pendingRevokedAt,
      status: busabaseRouterPendingEnrollments.status,
    })
    .from(busabaseRouterConnections)
    .innerJoin(busabaseRouterGrants, eq(busabaseRouterGrants.id, busabaseRouterConnections.grantId))
    .innerJoin(
      busabaseRouterPendingEnrollments,
      and(
        eq(busabaseRouterPendingEnrollments.grantId, busabaseRouterConnections.grantId),
        eq(
          busabaseRouterPendingEnrollments.acprouterEnrollmentId,
          busabaseRouterConnections.acprouterEnrollmentId,
        ),
      ),
    )
    .where(
      and(
        eq(busabaseRouterGrants.busabaseSpaceId, spaceId),
        eq(busabaseRouterGrants.busabaseActorId, getContextActorId() ?? ""),
      ),
    );
  const names = await listConnectionNames();
  return connections.map((connection) => ({
    slug: getRouterConnectionSlug(connection.id),
    agentSlug: connection.agentSlug,
    agentName: connectionDisplayName(
      names,
      connectionNameOwner(),
      getRouterConnectionSlug(connection.id),
      connection.agentSlug,
    ),
    grantId: connection.grantId,
    connectionState: connection.pendingRevokedAt
      ? "disconnecting"
      : connection.status === "connected"
        ? "ready"
        : "activating",
  }));
}

/**
 * Task 8.6 — resolve a stable connection to `{url, authHeader}`, matching the
 * `ResolvedLaunch` shape `agent-catalog.ts` already uses for Buda's
 * remote-websocket transport. Reads the vault-held consumer secret this
 * connection was created with (task 8.5) rather than re-deriving anything.
 *
 * Post-draft review fixes, all enforced before any secret is returned:
 * 1. A connection with `pendingRevokedAt` set (a disconnect is in flight or
 *    the prior remote-revoke attempt is still unresolved) must never launch
 *    — closes the TOCTOU gap where the UI could still open a session for a
 *    connection the user already asked to disconnect.
 * 2. The grant itself must still be live (`revokedAt IS NULL`) — a grant
 *    revoked through some other path (explicit OAuth revoke, membership-loss
 *    cascade) must not leave its still-present connection rows launchable.
 * 3. The stored connection URL's origin must match the CURRENTLY configured
 *    trusted ACPRouter origin — a URL stored under a since-changed
 *    `ACPROUTER_ENROLLMENT_ORIGIN`, or any value that didn't originate from
 *    that trusted origin in the first place, must never be handed to the
 *    client as something to open a WebSocket to.
 */
export async function resolveRouterConnectionLaunch(slug: string): Promise<RouterConnectionLaunch> {
  const found = await readConnectionRow(slug);
  if (!found) throw new Error("This ACPRouter agent is not connected.");
  if (found.connection.pendingRevokedAt) {
    throw new Error("This ACPRouter agent is being disconnected. Try again once that completes.");
  }
  if (found.grant.revokedAt) {
    throw new Error("This ACPRouter connection is no longer authorized.");
  }
  const database = await getDb();
  const [pending] = await database
    .select()
    .from(busabaseRouterPendingEnrollments)
    .where(
      and(
        eq(busabaseRouterPendingEnrollments.grantId, found.grant.id),
        eq(
          busabaseRouterPendingEnrollments.acprouterEnrollmentId,
          found.connection.acprouterEnrollmentId,
        ),
      ),
    );
  if (!pending || pending.status !== "connected")
    throw new Error("Finish pairing activation before starting a session.");
  const [vaultItem] = await database
    .select()
    .from(busabaseVaultItems)
    .where(eq(busabaseVaultItems.id, found.connection.vaultItemId));
  if (!vaultItem) throw new Error("This ACPRouter connection's credentials are missing.");
  const stored = JSON.parse(decodeVaultValue(vaultItem.valuePayload)) as StoredConnectionSecret;

  let storedOrigin: string;
  try {
    storedOrigin = new URL(stored.url).origin;
  } catch {
    throw new Error("This ACPRouter connection's stored URL is invalid.");
  }
  if (storedOrigin !== trustedConsumerWsOrigin()) {
    throw new Error("This ACPRouter connection's stored URL does not match a trusted origin.");
  }
  const tokens = await getRouterGrantTokens(found.grant.id);
  const live = await trustedFetch(
    new URL("/api/busabase-enrollment/grant-info", resolveAcprouterEnrollmentOrigin()),
    {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    },
  );
  if (!live.ok) throw new Error("This ACPRouter connection is no longer authorized.");

  return { url: stored.url, authHeader: `Bearer ${stored.secret}` };
}

/**
 * Task 8.6 — disconnect a single stable connection (post-draft review
 * rewrite). Three fixes over the prior version:
 *
 * 1. **Device-scoped, not grant-scoped.** The prior code called ACPRouter's
 *    `/api/oauth/revoke`, which revokes the WHOLE grant/token — every
 *    sibling device enrolled under the same grant would be torn down by one
 *    device's disconnect. This now calls the device-scoped
 *    `/api/busabase-enrollment/device` endpoint (post-draft review fix on
 *    the ACPRouter side), which revokes exactly this `enrollmentId`'s
 *    consumer key/completion/bridge credential and leaves the grant and
 *    every other device alone. Removing the WHOLE integration (revoking the
 *    grant itself) is a deliberately separate, not-yet-wired action — this
 *    function's own job is "disconnect this one agent".
 * 2. **`pendingRevokedAt` set BEFORE the network call**, so
 *    `resolveRouterConnectionLaunch` immediately refuses to launch this
 *    connection even if the remote call is slow, retried, or never
 *    completes — the connection cannot be used while a disconnect is in
 *    flight, independent of network outcome. Retained on failure so the
 *    connection stays blocked while the user retries the disconnect.
 * 3. **Atomic, correctly-ordered delete.** `busabaseRouterConnections` has
 *    no FK pointing at `busabaseVaultItems` (the reference runs the other
 *    way only in intent, not in the schema), but both rows must disappear
 *    together — wrapped in one `db.transaction` so a crash between the two
 *    deletes can never leave one without the other. The connection row is
 *    deleted first (it is the row carrying `vaultItemId`, i.e. the pointer),
 *    then the vault item it pointed to — never the reverse, which would
 *    briefly leave a connection row referencing an already-deleted vault
 *    item.
 *
 * If `ACPROUTER_ENROLLMENT_ORIGIN` is unset (enrollment disabled by
 * configuration), this must NOT attempt any network call or touch any row —
 * a config-only disable is not the same as the user asking to revoke a real
 * credential, and must not silently destroy one.
 */
export async function disconnectRouterConnection(slug: string): Promise<boolean> {
  const found = await readConnectionRow(slug);
  if (!found) return false;

  const acprouterOrigin = resolveAcprouterEnrollmentOrigin();
  const database = await getDb();

  await database
    .update(busabaseRouterConnections)
    .set({ pendingRevokedAt: new Date() })
    .where(eq(busabaseRouterConnections.id, found.connection.id));

  try {
    const tokens = await getRouterGrantTokens(found.grant.id, true);
    const response = await trustedFetch(
      new URL("/api/busabase-enrollment/device", acprouterOrigin),
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${tokens.refreshToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ enrollmentId: found.connection.acprouterEnrollmentId }),
      },
    );
    // A 404 means ACPRouter already has no live device for this
    // enrollmentId — treated as success so a retried disconnect (e.g. the
    // first call's response was lost but the revoke actually landed) is
    // idempotent rather than stuck failing forever.
    if (!response.ok && response.status !== 404) {
      throw new Error("ACPRouter could not revoke this device. Try again.");
    }
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("ACPRouter could not revoke this device. Try again.");
  }

  await database.transaction(async (tx) => {
    await tx
      .delete(busabaseRouterConnections)
      .where(eq(busabaseRouterConnections.id, found.connection.id));
    await tx
      .delete(busabaseVaultItems)
      .where(eq(busabaseVaultItems.id, found.connection.vaultItemId));
    await tx
      .update(busabaseRouterPendingEnrollments)
      .set({ status: "failed", consumerSecretEncrypted: null, updatedAt: new Date() })
      .where(
        and(
          eq(busabaseRouterPendingEnrollments.grantId, found.grant.id),
          eq(
            busabaseRouterPendingEnrollments.acprouterEnrollmentId,
            found.connection.acprouterEnrollmentId,
          ),
        ),
      );
  });
  return true;
}
