import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { getContextActorId, getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { assertWorkspacePermission } from "../../../logic/node-acl";
import { decodeVaultValue, encodeVaultValue } from "../../vault/logic/vault-crypto";
import { busabaseVaultItems } from "../../vault/schema/vault-items";
import { busabaseRouterGrants } from "../schema/router-grants";
import { busabaseRouterOauthStates } from "../schema/router-oauth-states";
import { resolveAcprouterEnrollmentOrigin } from "./acprouter-origin-config";

const TOKEN_VAULT_KEY_PREFIX = "ACPROUTER_ROUTER_GRANT_TOKEN:";

export interface StoredRouterGrantTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const ENROLLMENT_RESOURCE_PATH = "/api/busabase-enrollment";
const CLIENT_ID = "busabase-cloud-enrollment";

function signingSecret(): string {
  const key = process.env.BETTER_AUTH_SECRET || process.env.BUSABASE_VAULT_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("BETTER_AUTH_SECRET is required for the ACPRouter OAuth connect flow.");
  }
  return key;
}

function signState(nonce: string): string {
  return createHmac("sha256", signingSecret()).update(nonce).digest("base64url");
}

/** `${nonce}.${signature}` — the value actually round-tripped through ACPRouter's consent page. */
function buildSignedState(): { nonce: string; signedState: string } {
  const nonce = randomBytes(24).toString("base64url");
  return { nonce, signedState: `${nonce}.${signState(nonce)}` };
}

function verifySignedState(signedState: string): boolean {
  const [nonce, signature] = signedState.split(".");
  if (!nonce || !signature) return false;
  const expected = signState(nonce);
  return (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}

/**
 * Post-draft review fix: every outbound call to ACPRouter in this file
 * carries either a bearer access token or (for the token endpoint) a PKCE
 * code verifier / refresh token. `fetch`'s default behavior transparently
 * follows redirects, re-sending those same headers/credentials to wherever
 * the response's `Location` points — a compromised or misconfigured
 * intermediary responding with a redirect could exfiltrate the bearer token
 * to an attacker-chosen host without this code ever treating it as
 * anomalous. `redirect: "manual"` turns a redirect into an opaque
 * `type: "opaqueredirect"` response instead of following it, so this helper
 * can treat that the same as any other untrusted response and refuse to
 * read a body from it. A 5s timeout bounds how long a hung/malicious origin
 * can hold a request open.
 */
export async function trustedFetch(url: string | URL, init: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (response.type === "opaqueredirect") {
    throw new Error("ACPRouter responded with an unexpected redirect.");
  }
  return response;
}

export interface StartRouterOauthResult {
  redirectUrl: string;
}

/**
 * Task 8.1 — begin the "Connect via ACPRouter" flow.
 *
 * Requires `write` permission BEFORE any row is written (task 8.1's own
 * verify instruction: "no-write-permission rejected before any row
 * written") — `assertWorkspacePermission` throws synchronously, so a
 * rejection here genuinely never reaches the `insert`.
 */
export async function startRouterOauth(redirectUri: string): Promise<StartRouterOauthResult> {
  assertWorkspacePermission("write");

  const actorId = getContextActorId();
  if (!actorId) throw new Error("Sign in to Busabase first.");
  const spaceId = getContextSpaceId();

  const acprouterOrigin = resolveAcprouterEnrollmentOrigin();
  const database = await getDb();

  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const { nonce, signedState } = buildSignedState();
  const now = new Date();

  await database.insert(busabaseRouterOauthStates).values({
    id: `rst_${nonce}`,
    busabaseActorId: actorId,
    busabaseSpaceId: spaceId,
    pkceVerifier: codeVerifier,
    signedState,
    status: "pending",
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
    createdAt: now,
  });

  const authorizeUrl = new URL("/api/oauth/authorize", acprouterOrigin);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set(
    "resource",
    new URL(ENROLLMENT_RESOURCE_PATH, acprouterOrigin).toString(),
  );
  authorizeUrl.searchParams.set("scope", "enrollment");
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", signedState);

  return { redirectUrl: authorizeUrl.toString() };
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function exchangeAuthorizationCode(
  acprouterOrigin: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const response = await trustedFetch(new URL("/api/oauth/token", acprouterOrigin), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      resource: new URL(ENROLLMENT_RESOURCE_PATH, acprouterOrigin).toString(),
    }),
  });
  if (!response.ok) throw new Error("ACPRouter token exchange failed.");
  const body = (await response.json()) as Partial<TokenResponse>;
  if (
    typeof body.access_token !== "string" ||
    typeof body.refresh_token !== "string" ||
    typeof body.expires_in !== "number"
  ) {
    throw new Error("ACPRouter returned an incomplete token response.");
  }
  return body as TokenResponse;
}

interface GrantInfoResponse {
  issuer: string;
  clientId: string;
  grantId: string;
  userId: string;
  spaceId: string;
  spaceName: string;
  role: string;
}

async function fetchGrantInfo(
  acprouterOrigin: string,
  accessToken: string,
): Promise<GrantInfoResponse> {
  const response = await trustedFetch(
    new URL("/api/busabase-enrollment/grant-info", acprouterOrigin),
    {
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) throw new Error("ACPRouter rejected the grant-info request.");
  const body = (await response.json()) as Partial<GrantInfoResponse>;
  if (
    body.issuer !== acprouterOrigin ||
    body.clientId !== CLIENT_ID ||
    typeof body.grantId !== "string" ||
    !body.grantId ||
    typeof body.userId !== "string" ||
    !body.userId ||
    typeof body.spaceId !== "string" ||
    typeof body.spaceName !== "string" ||
    typeof body.role !== "string"
  ) {
    throw new Error("ACPRouter returned an incomplete grant-info response.");
  }
  return body as GrantInfoResponse;
}

export interface CompleteRouterOauthResult {
  grantId: string;
  acprouterSpaceName: string;
}

/**
 * Task 8.2 — finish the "Connect via ACPRouter" flow.
 *
 * Order of operations is deliberate and every step must pass before the
 * grant row is persisted:
 * 1. Consume the signed one-use state exactly once (atomic claim via
 *    `UPDATE ... WHERE status = 'pending' RETURNING` — a second call with
 *    the same `signedState` finds zero rows and is rejected, which is what
 *    makes a replayed callback request a no-op rather than a double-grant).
 * 2. Re-verify the CURRENTLY signed-in actor matches the actor the flow was
 *    STARTED under, and is still a member of the frozen space — a
 *    different actor completing someone else's callback (e.g. a shared
 *    browser, or a stolen callback URL) must not succeed just because the
 *    state signature itself is valid.
 * 3. Only then exchange the code and call grant-info.
 *
 * `currentActorId`/`isStillMemberOfFrozenSpace` are caller-supplied rather
 * than read from context here, because by the time the OAuth callback
 * fires there may be a different session attached to this request than the
 * one that started the flow — the route handler resolves "who is signed in
 * right now" itself and must pass it in explicitly rather than this
 * function silently trusting whatever ambient context happens to be bound.
 */
export async function completeRouterOauth(params: {
  signedState: string;
  code: string;
  redirectUri: string;
  currentActorId: string;
  isStillMemberOfFrozenSpace: (spaceId: string) => Promise<boolean>;
}): Promise<CompleteRouterOauthResult> {
  if (!verifySignedState(params.signedState)) {
    throw new Error("This ACPRouter connection request is invalid or was tampered with.");
  }

  const database = await getDb();
  const now = new Date();

  const [consumed] = await database
    .update(busabaseRouterOauthStates)
    .set({ status: "consumed", consumedAt: now })
    .where(
      and(
        eq(busabaseRouterOauthStates.signedState, params.signedState),
        eq(busabaseRouterOauthStates.status, "pending"),
      ),
    )
    .returning();

  if (!consumed) {
    throw new Error("This ACPRouter connection request already completed or expired.");
  }
  if (consumed.expiresAt.getTime() <= now.getTime()) {
    throw new Error("This ACPRouter connection request expired. Try again.");
  }
  if (consumed.busabaseActorId !== params.currentActorId) {
    throw new Error("This ACPRouter connection request belongs to a different signed-in user.");
  }
  if (!(await params.isStillMemberOfFrozenSpace(consumed.busabaseSpaceId))) {
    throw new Error("You are no longer a member of the workspace that started this connection.");
  }

  const acprouterOrigin = resolveAcprouterEnrollmentOrigin();
  const token = await exchangeAuthorizationCode(
    acprouterOrigin,
    params.code,
    consumed.pkceVerifier,
    params.redirectUri,
  );
  const grantInfo = await fetchGrantInfo(acprouterOrigin, token.access_token);

  const grantId = `rgr_${randomBytes(16).toString("base64url")}`;
  const stored: StoredRouterGrantTokens = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(now.getTime() + token.expires_in * 1000).toISOString(),
  };
  const vaultItemId = `vlt_${randomBytes(16).toString("base64url")}`;
  await database.transaction(async (tx) => {
    await tx.insert(busabaseVaultItems).values({
      id: vaultItemId,
      userId: consumed.busabaseActorId,
      kind: "secret",
      key: `${TOKEN_VAULT_KEY_PREFIX}${grantId}`,
      valuePayload: encodeVaultValue(JSON.stringify({ ...stored, grantIdentity: grantInfo }), {
        requireEncryption: true,
      }),
      scopeType: "workspace",
      scopeId: consumed.busabaseSpaceId,
      environment: "production",
      description: `ACPRouter grant: ${grantInfo.spaceName}`,
      access: { runtime: false, reveal: false, edit: false, share: false },
    });
    await tx.insert(busabaseRouterGrants).values({
      id: grantId,
      busabaseActorId: consumed.busabaseActorId,
      busabaseSpaceId: consumed.busabaseSpaceId,
      acprouterSpaceId: grantInfo.spaceId,
      acprouterSpaceName: grantInfo.spaceName,
      tokenVaultItemId: vaultItemId,
      createdAt: now,
    });
  });

  return { grantId, acprouterSpaceName: grantInfo.spaceName };
}

/** Read the live (non-revoked) token pair for a grant, refreshing it first if it is near expiry. */
export async function getRouterGrantTokens(
  grantId: string,
  forCleanup = false,
): Promise<StoredRouterGrantTokens> {
  const database = await getDb();
  const [grant] = await database
    .select()
    .from(busabaseRouterGrants)
    .where(
      and(
        eq(busabaseRouterGrants.id, grantId),
        eq(busabaseRouterGrants.busabaseSpaceId, getContextSpaceId()),
        eq(busabaseRouterGrants.busabaseActorId, getContextActorId() ?? ""),
        isNull(busabaseRouterGrants.revokedAt),
      ),
    );
  if (!grant) throw new Error("This ACPRouter connection is no longer authorized.");

  const [vaultItem] = await database
    .select()
    .from(busabaseVaultItems)
    .where(eq(busabaseVaultItems.id, grant.tokenVaultItemId));
  if (!vaultItem) throw new Error("This ACPRouter connection's credentials are missing.");

  let stored = JSON.parse(decodeVaultValue(vaultItem.valuePayload)) as StoredRouterGrantTokens;
  if (!forCleanup && new Date(stored.expiresAt).getTime() <= Date.now() + 60_000) {
    stored = await database.transaction(async (tx) => {
      // Serialize rotation across workers and reuse the winner's token pair.
      const [locked] = await tx
        .select()
        .from(busabaseVaultItems)
        .where(eq(busabaseVaultItems.id, grant.tokenVaultItemId))
        .for("update");
      if (!locked) throw new Error("This ACPRouter connection's credentials are missing.");
      const latest = JSON.parse(decodeVaultValue(locked.valuePayload)) as StoredRouterGrantTokens;
      if (new Date(latest.expiresAt).getTime() > Date.now() + 60_000) return latest;
      return refreshRouterGrantTokens(grantId, latest, tx as unknown as typeof database);
    });
  }
  return stored;
}

async function refreshRouterGrantTokens(
  grantId: string,
  current: StoredRouterGrantTokens,
  database: Awaited<ReturnType<typeof getDb>>,
): Promise<StoredRouterGrantTokens> {
  const [grant] = await database
    .select()
    .from(busabaseRouterGrants)
    .where(eq(busabaseRouterGrants.id, grantId));
  if (!grant) throw new Error("This ACPRouter connection is no longer authorized.");

  const acprouterOrigin = resolveAcprouterEnrollmentOrigin();
  const response = await trustedFetch(new URL("/api/oauth/token", acprouterOrigin), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: current.refreshToken,
      resource: new URL(ENROLLMENT_RESOURCE_PATH, acprouterOrigin).toString(),
    }),
  });
  if (!response.ok) throw new Error("ACPRouter authorization expired. Reconnect to continue.");
  const body = (await response.json()) as Partial<TokenResponse>;
  if (
    typeof body.access_token !== "string" ||
    typeof body.refresh_token !== "string" ||
    typeof body.expires_in !== "number"
  ) {
    throw new Error("ACPRouter returned an invalid refreshed credential.");
  }
  const next: StoredRouterGrantTokens = {
    ...current,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
  };
  await database
    .update(busabaseVaultItems)
    .set({
      valuePayload: encodeVaultValue(JSON.stringify(next), {
        requireEncryption: getContextActorId() !== undefined,
      }),
      updatedAt: new Date(),
    })
    .where(eq(busabaseVaultItems.id, grant.tokenVaultItemId));
  return next;
}

/** Housekeeping: drop pending states that expired without ever being consumed. */
export async function sweepExpiredRouterOauthStates(now = new Date()): Promise<number> {
  const database = await getDb();
  const deleted = await database
    .delete(busabaseRouterOauthStates)
    .where(
      and(
        isNull(busabaseRouterOauthStates.consumedAt),
        lt(busabaseRouterOauthStates.expiresAt, now),
      ),
    )
    .returning();
  return deleted.length;
}
