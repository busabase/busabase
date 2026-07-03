import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { busabaseConfig } from "~/connection/config";
import { type CloudSession, setCloudSession } from "./session-store";

WebBrowser.maybeCompleteAuthSession();

interface OAuthAuthorizationRequest {
  url: string;
  state: string;
  codeVerifier: string;
}

interface OAuthTokenResponse extends CloudSession {
  iss?: string;
}

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

const normalizeOrigin = (value: string) => value.replace(/\/$/, "");

const buildAuthorizeUrl = async (): Promise<OAuthAuthorizationRequest> => {
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const url = new URL("/api/oauth/authorize", busabaseConfig.cloudUrl);
  url.searchParams.set("client_id", busabaseConfig.oauthClientId);
  url.searchParams.set("client_platform", busabaseConfig.oauthClientPlatform);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", busabaseConfig.oauthRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "login");
  return { url: url.toString(), state, codeVerifier };
};

const exchangeCode = async (input: {
  code: string;
  codeVerifier: string;
  state: string;
}): Promise<CloudSession> => {
  const response = await fetch(new URL("/api/oauth/token", busabaseConfig.cloudUrl).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": busabaseConfig.userAgent,
      "x-busabase-client": "native",
      "x-busabase-client-platform": "mobile",
    },
    body: JSON.stringify({
      client_id: busabaseConfig.oauthClientId,
      client_platform: busabaseConfig.oauthClientPlatform,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: busabaseConfig.oauthRedirectUri,
      state: input.state,
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed (${response.status})`);
  }

  const sessionToken = response.headers.get("set-auth-token");
  const json = (await response.json()) as OAuthTokenResponse;
  const normalizedSession: CloudSession = {
    ...json,
    token: sessionToken ?? json.token ?? json.accessToken,
    accessToken: json.accessToken ?? sessionToken ?? json.token ?? "",
  };
  if (!normalizedSession.accessToken.startsWith("bss_")) {
    throw new Error("OAuth token response did not include a native session token");
  }

  const issuer = json.iss ? normalizeOrigin(json.iss) : null;
  const expectedIssuer = normalizeOrigin(busabaseConfig.cloudUrl);
  if (issuer && issuer !== expectedIssuer) {
    throw new Error(`OAuth issuer mismatch: expected ${expectedIssuer}, got ${issuer}`);
  }

  return normalizedSession;
};

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
  if (!code || !state || state !== request.state) {
    throw new Error("Invalid OAuth callback");
  }

  const session = await exchangeCode({
    code,
    codeVerifier: request.codeVerifier,
    state,
  });
  await setCloudSession(session);
  return session;
}

export async function revokeBusabaseCloudSession(session: CloudSession | null): Promise<void> {
  const token = session?.accessToken ?? session?.token;
  if (!token) return;
  await fetch(new URL("/api/oauth/revoke", busabaseConfig.cloudUrl).toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => undefined);
}
