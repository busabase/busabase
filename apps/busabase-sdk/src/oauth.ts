import { BUSABASE_AIRAPP_CLIENT_ID } from "busabase-contract/auth/device-authorization";
import { normalizeBaseUrl } from "./url.js";

export { BUSABASE_AIRAPP_CLIENT_ID };

/** The only scope an AirApp ever requests; bound to the `/api/v1` resource. */
export const AIRAPP_OAUTH_SCOPE = "api";

export interface BusabaseOAuthRequest {
  authorizeUrl: string;
  baseUrl: string;
  clientId: string;
  codeVerifier: string;
  redirectUri: string;
  resource: string;
  state: string;
}

export interface CreateBusabaseOAuthRequestInput {
  baseUrl: string;
  redirectUri: string;
  clientId?: string;
  state?: string;
  prompt?: "login";
}

export interface BusabaseOAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  expiresAt: string;
  scope: string[];
  tokenType: string;
  user?: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
}

export interface RegisterBusabaseAirAppOAuthClientInput {
  appId: string;
  baseUrl: string;
  redirectUri: string;
}

export class BusabaseOAuthError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "BusabaseOAuthError";
    this.code = code;
    this.status = status;
  }
}

const oauthBaseUrl = (raw: string) => {
  let url: URL;
  try {
    url = new URL(normalizeBaseUrl(raw));
  } catch {
    throw new BusabaseOAuthError("invalid_base_url", "Busabase base URL is invalid");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new BusabaseOAuthError(
      "invalid_base_url",
      "Busabase base URL must be an HTTP(S) origin without credentials, query, or path",
    );
  }
  return url.origin;
};

const randomBase64Url = (byteLength: number) => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const digestBase64Url = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const data = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Register an exact HTTPS callback for a public AirApp OAuth client. */
export async function registerBusabaseAirAppOAuthClient(
  input: RegisterBusabaseAirAppOAuthClientInput,
  fetchImpl: typeof fetch = fetch,
) {
  const baseUrl = oauthBaseUrl(input.baseUrl);
  const redirectUri = new URL(input.redirectUri).toString();
  const response = await fetchImpl(new URL("/api/oauth/register", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: input.appId,
      client_kind: "airapp",
      scope: AIRAPP_OAUTH_SCOPE,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new BusabaseOAuthError(
      typeof body?.error === "string" ? body.error : "client_registration_failed",
      typeof body?.error_description === "string"
        ? body.error_description
        : `Busabase OAuth client registration failed (${response.status})`,
      response.status,
    );
  }
  if (
    typeof body?.client_id !== "string" ||
    !Array.isArray(body.redirect_uris) ||
    body.redirect_uris.length !== 1 ||
    body.redirect_uris[0] !== redirectUri
  ) {
    throw new BusabaseOAuthError(
      "invalid_client_registration",
      "Busabase returned an invalid OAuth client registration",
    );
  }
  // A server that predates AirApp registration silently issues an `mcp` client instead, which
  // then fails at /api/oauth/authorize with an opaque 400. Detect the skew here where the
  // message can name the real cause.
  const grantedScopes =
    typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : null;
  if (!grantedScopes?.includes(AIRAPP_OAUTH_SCOPE)) {
    throw new BusabaseOAuthError(
      "unsupported_airapp_registration",
      `This Busabase server did not grant the "${AIRAPP_OAUTH_SCOPE}" scope to a dynamically registered AirApp. Upgrade Busabase, or run the AirApp on a loopback address to use the shared AirApp client.`,
    );
  }
  return { clientId: body.client_id, redirectUri };
}

/** Build a public-client OAuth 2.1 authorization request with PKCE S256. */
export async function createBusabaseOAuthRequest(
  input: CreateBusabaseOAuthRequestInput,
): Promise<BusabaseOAuthRequest> {
  const baseUrl = oauthBaseUrl(input.baseUrl);
  const redirectUri = new URL(input.redirectUri).toString();
  const clientId = input.clientId ?? BUSABASE_AIRAPP_CLIENT_ID;
  const codeVerifier = randomBase64Url(32);
  const state = input.state ?? randomBase64Url(24);
  const resource = new URL("/api/v1", baseUrl).toString();
  const authorizeUrl = new URL("/api/oauth/authorize", baseUrl);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    resource,
    scope: AIRAPP_OAUTH_SCOPE,
    code_challenge: await digestBase64Url(codeVerifier),
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    state,
  }).toString();
  if (input.prompt) authorizeUrl.searchParams.set("prompt", input.prompt);
  return {
    authorizeUrl: authorizeUrl.toString(),
    baseUrl,
    clientId,
    codeVerifier,
    redirectUri,
    resource,
    state,
  };
}

/** Validate state and issuer before accepting the authorization code. */
export function parseBusabaseOAuthCallback(callbackUrl: string, request: BusabaseOAuthRequest) {
  const callback = new URL(callbackUrl);
  const error = callback.searchParams.get("error");
  if (error) {
    throw new BusabaseOAuthError(
      error,
      callback.searchParams.get("error_description") || "Busabase authorization was denied",
    );
  }
  if (callback.searchParams.get("state") !== request.state) {
    throw new BusabaseOAuthError("state_mismatch", "OAuth callback state did not match");
  }
  const issuer = callback.searchParams.get("iss");
  let issuerMatches = false;
  try {
    issuerMatches = Boolean(issuer && new URL(issuer).origin === new URL(request.baseUrl).origin);
  } catch {
    issuerMatches = false;
  }
  if (!issuerMatches) {
    throw new BusabaseOAuthError("issuer_mismatch", "OAuth callback issuer did not match");
  }
  const code = callback.searchParams.get("code");
  if (!code) throw new BusabaseOAuthError("missing_code", "OAuth callback had no code");
  return code;
}

const parseTokenResponse = async (response: Response): Promise<BusabaseOAuthTokenSet> => {
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof body?.error === "string" ? body.error : "token_request_failed";
    const message =
      typeof body?.error_description === "string"
        ? body.error_description
        : `Busabase OAuth token request failed (${response.status})`;
    throw new BusabaseOAuthError(code, message, response.status);
  }
  if (typeof body?.access_token !== "string" || typeof body.expires_in !== "number") {
    throw new BusabaseOAuthError(
      "invalid_token_response",
      "Busabase returned an invalid token set",
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expiresIn: body.expires_in,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
    scope: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
    tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
    user:
      body.user && typeof body.user === "object"
        ? (body.user as BusabaseOAuthTokenSet["user"])
        : undefined,
  };
};

export async function exchangeBusabaseOAuthCode(
  request: BusabaseOAuthRequest,
  code: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(new URL("/api/oauth/token", request.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: request.clientId,
      code,
      code_verifier: request.codeVerifier,
      redirect_uri: request.redirectUri,
      resource: request.resource,
    }),
  });
  return parseTokenResponse(response);
}

export async function refreshBusabaseOAuthToken(
  input: {
    baseUrl: string;
    refreshToken: string;
    clientId?: string;
  },
  fetchImpl: typeof fetch = fetch,
) {
  const baseUrl = oauthBaseUrl(input.baseUrl);
  const response = await fetchImpl(new URL("/api/oauth/token", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId ?? BUSABASE_AIRAPP_CLIENT_ID,
      resource: new URL("/api/v1", baseUrl).toString(),
    }),
  });
  return parseTokenResponse(response);
}

export async function revokeBusabaseOAuthToken(
  input: {
    baseUrl: string;
    token: string;
    clientId?: string;
  },
  fetchImpl: typeof fetch = fetch,
) {
  const baseUrl = oauthBaseUrl(input.baseUrl);
  const response = await fetchImpl(new URL("/api/oauth/revoke", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: input.token,
      client_id: input.clientId ?? BUSABASE_AIRAPP_CLIENT_ID,
    }),
  });
  if (!response.ok) {
    throw new BusabaseOAuthError(
      "revoke_failed",
      `Busabase OAuth revocation failed (${response.status})`,
      response.status,
    );
  }
}
