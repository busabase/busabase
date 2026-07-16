/**
 * Cloud Connect OAuth client — the OSS half of the Local ↔ Cloud Tunnel connect
 * handshake (spec §5a). Copies `apps/busabase-cli/src/login.ts`'s PKCE
 * mechanics against the same `/api/oauth/authorize` + `/api/oauth/token`
 * endpoints, but targets `client_platform=tunnel` (NOT `native`/`cli`) and
 * threads this instance's stable local `tunnelId` through the authorize
 * request, per the main spec's decided credential model.
 *
 * Adaptation from the CLI precedent: `apps/busabase-cli` has no running HTTP
 * server of its own, so it spins up an ephemeral loopback callback server just
 * for the OAuth round-trip. `apps/busabase` IS already a running Next.js
 * server, whether reachable at `http://localhost:<port>` (dev) or at this
 * instance's own public HTTPS hostname (a self-hosted deployment) — both are
 * accepted by Cloud's `isAllowedRedirectUri` for `client_platform=tunnel` —
 * so its own `/api/cloud-connect/callback` route IS the callback endpoint; no
 * second server is spun up. Pending-flow state (the PKCE code_verifier) is
 * kept in-memory here, keyed by `state`, exactly like the CLI keeps it in the
 * closure of its loopback server.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";

const CLIENT_ID = "busabase-oss";
const CLIENT_PLATFORM = "tunnel";
const PENDING_FLOW_TTL_MS = 5 * 60 * 1000;

interface PendingFlow {
  codeVerifier: string;
  cloudUrl: string;
  redirectUri: string;
  createdAt: number;
}

type GlobalWithPendingFlows = typeof globalThis & {
  __busabaseCloudConnectPendingFlows?: Map<string, PendingFlow>;
};

// Module-level in-memory store, HMR-safe via globalThis (mirrors ~/db's lazy
// singleton pattern) — Next dev's module reloads shouldn't drop an in-flight
// OAuth attempt.
function getPendingFlows(): Map<string, PendingFlow> {
  const g = globalThis as GlobalWithPendingFlows;
  if (!g.__busabaseCloudConnectPendingFlows) {
    g.__busabaseCloudConnectPendingFlows = new Map();
  }
  return g.__busabaseCloudConnectPendingFlows;
}

function cleanupExpiredFlows(): void {
  const flows = getPendingFlows();
  const now = Date.now();
  for (const [state, flow] of flows) {
    if (now - flow.createdAt > PENDING_FLOW_TTL_MS) flows.delete(state);
  }
}

const base64url = (buffer: Buffer): string => buffer.toString("base64url");

export interface TunnelConnectCredential {
  token: string;
  tunnelId: string;
  expiresAt: string;
}

export interface BeginConnectInput {
  cloudUrl: string;
  tunnelId: string;
  redirectUri: string;
}

/** Build the authorize URL + persist the PKCE verifier under a fresh `state`. */
export function beginCloudConnectAuthorize(input: BeginConnectInput): { authorizeUrl: string } {
  cleanupExpiredFlows();

  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const state = base64url(randomBytes(16));

  getPendingFlows().set(state, {
    codeVerifier,
    cloudUrl: input.cloudUrl,
    redirectUri: input.redirectUri,
    createdAt: Date.now(),
  });

  const authorizeUrl = new URL("/api/oauth/authorize", input.cloudUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", CLIENT_ID);
  authorizeUrl.searchParams.set("client_platform", CLIENT_PLATFORM);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("redirect_uri", input.redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("tunnel_id", input.tunnelId);
  // Force re-authentication so Cloud Connect never silently links this OSS
  // instance to whatever account the default browser already has a live
  // session for — the admin always confirms which account they're connecting.
  authorizeUrl.searchParams.set("prompt", "login");

  return { authorizeUrl: authorizeUrl.toString() };
}

/** Exchange the callback's `code` for a scoped tunnel-connect credential. */
export async function completeCloudConnectAuthorize(input: {
  code: string;
  state: string;
}): Promise<TunnelConnectCredential> {
  cleanupExpiredFlows();
  const flows = getPendingFlows();
  const flow = flows.get(input.state);
  if (!flow) {
    throw new Error("This Cloud sign-in link expired or was already used — click Connect again.");
  }
  flows.delete(input.state);

  const tokenRes = await fetch(new URL("/api/oauth/token", flow.cloudUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_platform: CLIENT_PLATFORM,
      code: input.code,
      code_verifier: flow.codeVerifier,
      redirect_uri: flow.redirectUri,
      state: input.state,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => "");
    throw new Error(`Token exchange failed (HTTP ${tokenRes.status})${text ? `: ${text}` : ""}`);
  }

  return parseCredentialResponse(await tokenRes.json());
}

/** `POST /api/oauth/refresh` — slides the credential forward, same token. */
export async function refreshCloudConnectCredential(
  cloudUrl: string,
  token: string,
): Promise<TunnelConnectCredential> {
  const res = await fetch(new URL("/api/oauth/refresh", cloudUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Credential refresh failed (HTTP ${res.status})`);
  return parseCredentialResponse(await res.json());
}

/** Best-effort `POST /api/oauth/revoke` — local disconnect proceeds regardless. */
export async function revokeCloudConnectCredential(cloudUrl: string, token: string): Promise<void> {
  try {
    await fetch(new URL("/api/oauth/revoke", cloudUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    // Cloud may be unreachable — the local credential is cleared by the caller
    // regardless, so this is not fatal.
  }
}

function parseCredentialResponse(payload: unknown): TunnelConnectCredential {
  const body = payload as { token?: unknown; tunnelId?: unknown; expiresAt?: unknown } | null;
  if (
    !body ||
    typeof body.token !== "string" ||
    typeof body.tunnelId !== "string" ||
    typeof body.expiresAt !== "string"
  ) {
    throw new Error("Cloud returned an unexpected tunnel-connect credential response.");
  }
  return { token: body.token, tunnelId: body.tunnelId, expiresAt: body.expiresAt };
}
