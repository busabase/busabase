import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { busabaseConfig } from "~/connection/config";
import {
  type CloudSession,
  getCloudSession,
  isCloudSessionAccessTokenUsable,
  setCloudSession,
} from "./session-store";

WebBrowser.maybeCompleteAuthSession();

interface OAuthAuthorizationRequest {
  url: string;
  state: string;
  codeVerifier: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
let refreshPromise: Promise<CloudSession | null> | null = null;

const bytesToBase64Url = (bytes: Uint8Array) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    output += alphabet[(triple >> 18) & 63];
    output += alphabet[(triple >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return output.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const randomBase64Url = (byteLength: number) => bytesToBase64Url(Crypto.getRandomBytes(byteLength));

const createCodeChallenge = async (verifier: string) => {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const normalizeOrigin = (value: string) => new URL(value).origin;

const buildAuthorizeUrl = async (): Promise<OAuthAuthorizationRequest> => {
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const url = new URL("/api/oauth/authorize", busabaseConfig.cloudUrl);
  url.searchParams.set("client_id", busabaseConfig.oauthClientId);
  url.searchParams.set("resource", new URL("/api/rpc", busabaseConfig.cloudUrl).toString());
  url.searchParams.set("scope", "rpc");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", busabaseConfig.oauthRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "login");
  return { url: url.toString(), state, codeVerifier };
};

const parseTokenResponse = (json: OAuthTokenResponse): CloudSession => {
  if (
    !json.access_token?.startsWith("bso_") ||
    !json.refresh_token?.startsWith("bsr_") ||
    typeof json.expires_in !== "number" ||
    json.expires_in <= 0
  ) {
    throw new Error("OAuth token response did not include a valid rotating token set");
  }
  const session: CloudSession = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
  return session;
};

const exchangeCode = async (input: {
  code: string;
  codeVerifier: string;
}): Promise<CloudSession> => {
  const response = await fetch(new URL("/api/oauth/token", busabaseConfig.cloudUrl).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": busabaseConfig.userAgent,
      "x-busabase-client": "native",
      "x-busabase-client-platform": "mobile",
    },
    body: new URLSearchParams({
      client_id: busabaseConfig.oauthClientId,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: busabaseConfig.oauthRedirectUri,
      resource: new URL("/api/rpc", busabaseConfig.cloudUrl).toString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed (${response.status})`);
  }

  return parseTokenResponse((await response.json()) as OAuthTokenResponse);
};

const refreshCloudSession = async (session: CloudSession): Promise<CloudSession | null> => {
  try {
    const response = await fetch(new URL("/api/oauth/token", busabaseConfig.cloudUrl).toString(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
        client_id: busabaseConfig.oauthClientId,
        resource: new URL("/api/rpc", busabaseConfig.cloudUrl).toString(),
      }),
    });
    if (!response.ok) return isCloudSessionAccessTokenUsable(session) ? session : null;
    const refreshed = parseTokenResponse((await response.json()) as OAuthTokenResponse);
    await setCloudSession(refreshed);
    return refreshed;
  } catch {
    return isCloudSessionAccessTokenUsable(session) ? session : null;
  }
};

export async function getValidBusabaseCloudSession(): Promise<CloudSession | null> {
  const session = await getCloudSession();
  if (!session) return null;
  if (isCloudSessionAccessTokenUsable(session, TOKEN_REFRESH_WINDOW_MS)) return session;
  if (!refreshPromise) {
    refreshPromise = refreshCloudSession(session).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function signInWithBusabaseCloud(): Promise<CloudSession> {
  const request = await buildAuthorizeUrl();
  WebBrowser.dismissAuthSession();
  const result = await WebBrowser.openAuthSessionAsync(
    request.url,
    busabaseConfig.oauthRedirectUri,
    { preferEphemeralSession: true },
  );

  if (result.type !== "success") {
    throw new Error(result.type === "cancel" ? "Sign in was cancelled" : "Sign in did not finish");
  }

  const callbackUrl = new URL(result.url);
  const error = callbackUrl.searchParams.get("error");
  if (error) throw new Error(error);

  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  const issuer = callbackUrl.searchParams.get("iss");
  if (!code || !state || state !== request.state) {
    throw new Error("Invalid OAuth callback");
  }
  if (!issuer || normalizeOrigin(issuer) !== normalizeOrigin(busabaseConfig.cloudUrl)) {
    throw new Error("OAuth authorization server issuer mismatch");
  }

  const session = await exchangeCode({
    code,
    codeVerifier: request.codeVerifier,
  });
  await setCloudSession(session);
  return session;
}

export async function revokeBusabaseCloudSession(session: CloudSession | null): Promise<void> {
  const token = session?.refreshToken ?? session?.accessToken;
  if (!token) return;
  await fetch(new URL("/api/oauth/revoke", busabaseConfig.cloudUrl).toString(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}
