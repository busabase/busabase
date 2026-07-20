import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline/promises";
import { BUSABASE_CLI_CLIENT_ID } from "busabase-contract/auth/device-authorization";
import { DEFAULT_BASE_URL, normalizeBaseUrl } from "busabase-sdk";
import { dotEnvPath, loadDotEnvFile, writeDotEnvFile } from "./config-file.js";

/**
 * `busabase-cli login` — sign in and persist credentials to `~/.busabase/.env`, so
 * every later CLI/SDK call and the installed `busabase` skill authenticate with no
 * further prompts. Two methods, like `claude` login:
 *
 *   - **Device authorization (preferred)**: prints a short code and a URL that
 *     can be opened on any computer or phone, then polls until the user approves.
 *     This works over SSH and inside containers without a loopback callback.
 *   - **Loopback OAuth (legacy fallback)**: explicitly requested by flag when
 *     browser and CLI share the same machine.
 *   - **API key**: paste (or pass `--api-key`) an `sk_…` key from the dashboard.
 *
 * Both end the same way: verify against `/api/v1/auth`, pick the target space, and
 * write `BUSABASE_BASE_URL` / `BUSABASE_API_KEY` / `BUSABASE_SPACE_ID`.
 */

const CLI_CLIENT_PLATFORM = "cli";
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** Env key holding the OAuth session expiry (ISO), used to drive built-in auto-refresh. */
const EXPIRES_AT_KEY = "BUSABASE_TOKEN_EXPIRES_AT";
const LEGACY_SESSION_TOKEN_PREFIX = "bss_";
/** Auto-refresh a login session once it's within this window of expiry. */
const AUTO_REFRESH_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

/** Default local `busabase server` address. */
const DEFAULT_LOCAL_URL = "http://localhost:15419";

export interface LoginOptions {
  baseUrl: string;
  /** Global `--api-key`; when present, login runs the non-interactive API-key path. */
  apiKey?: string;
  spaceId?: string;
  /** `--device-code` forces RFC 8628 device authorization. */
  deviceCode?: boolean;
  /** `--oauth` retains the legacy same-machine loopback flow. */
  oauth?: boolean;
  /** `--no-browser` sets this false: print the URL instead of opening a browser. */
  browser: boolean;
}

export interface LogoutOptions {
  baseUrl: string;
  /** The currently-saved credential (session token or API key), for revocation. */
  apiKey?: string;
}

interface AuthVerify {
  user?: { id?: string; name?: string; email?: string };
  space?: { id?: string; name?: string; slug?: string };
  spaces?: Array<{ id: string; name: string; slug?: string }>;
  createdSpace?: boolean;
  bootstrapRequired?: boolean;
}

const base64url = (buffer: Buffer): string => buffer.toString("base64url");

const isInteractive = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY);

/** Progress/prompts go to stderr so `--output json` keeps stdout a clean result. */
const say = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

/** True for a loopback host — typically an open-source local server, which has no login. */
const isLocalHost = (baseUrl: string): boolean => {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
};

/**
 * Probe whether a host actually requires authentication, by hitting a normally
 * auth-gated endpoint with no token. `401`/`403` ⇒ auth required (Cloud, or a
 * self-hosted cloud edition). Anything else ⇒ open (the local `busabase server`).
 * Throws a friendly error if the host can't be reached at all.
 */
async function probeAuthRequired(baseUrl: string): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/v1/bases`);
  } catch {
    throw new Error(
      `Could not reach ${baseUrl}. Is the server running? Start a local one with \`busabase server\`, or pass a reachable --base-url.`,
    );
  }
  return res.status === 401 || res.status === 403;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Best-effort "open this URL in the default browser" across macOS / Windows / Linux. */
function openBrowser(url: string): void {
  const platform = process.platform;
  const [command, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(command, args as string[], { stdio: "ignore", detached: true }).unref();
  } catch {
    // Non-fatal — the URL is always printed too, so the user can open it manually.
  }
}

async function verifyAuth(baseUrl: string, token: string): Promise<AuthVerify> {
  const res = await fetch(`${baseUrl}/api/v1/auth`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    throw new Error(
      `The credential was rejected (401) by ${baseUrl}. If it's an API key, check it in Dashboard → Settings → API Keys; if it's a login session, run \`busabase-cli login\` again.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Could not verify the credential (HTTP ${res.status}) from ${baseUrl}.`);
  }
  return (await res.json()) as AuthVerify;
}

// ── OAuth (PKCE loopback) ─────────────────────────────────────────────────────

/** Run the browser PKCE flow and return the native session token (+ its expiry). */
async function loopbackOauthLogin(
  baseUrl: string,
  useBrowser: boolean,
): Promise<{ token: string; expiresAt?: string; apiKeyExpiresAt?: string }> {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const state = base64url(randomBytes(16));

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>(
    (resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.writeHead(404).end("Not found");
          return;
        }
        const respond = (title: string, body: string) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(
            `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center"><h2>${title}</h2><p>${body}</p></body>`,
          );
        };
        const error = url.searchParams.get("error");
        const returnedState = url.searchParams.get("state");
        const returnedCode = url.searchParams.get("code");
        if (error) {
          respond("Sign-in failed", "You can close this tab and return to the terminal.");
          cleanup();
          reject(new Error(`Authorization failed: ${error}`));
          return;
        }
        if (!returnedCode || returnedState !== state) {
          respond("Sign-in failed", "State mismatch. You can close this tab and try again.");
          cleanup();
          reject(new Error("OAuth state mismatch — the callback did not match this request."));
          return;
        }
        respond("Signed in ✓", "You can close this tab and return to the terminal.");
        const address = server.address() as AddressInfo;
        cleanup();
        resolve({ code: returnedCode, redirectUri: `http://127.0.0.1:${address.port}/callback` });
      });

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for the browser sign-in (5 minutes)."));
      }, OAUTH_TIMEOUT_MS);

      function cleanup() {
        clearTimeout(timeout);
        server.close();
      }

      server.on("error", (err) => {
        cleanup();
        reject(err);
      });

      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        const redirect = `http://127.0.0.1:${port}/callback`;
        const authorizeUrl = new URL(`${baseUrl}/api/oauth/authorize`);
        authorizeUrl.searchParams.set("response_type", "code");
        authorizeUrl.searchParams.set("client_id", BUSABASE_CLI_CLIENT_ID);
        authorizeUrl.searchParams.set("client_platform", CLI_CLIENT_PLATFORM);
        authorizeUrl.searchParams.set("code_challenge", codeChallenge);
        authorizeUrl.searchParams.set("code_challenge_method", "S256");
        authorizeUrl.searchParams.set("redirect_uri", redirect);
        authorizeUrl.searchParams.set("state", state);
        // Force re-authentication so `busabase login` never silently reuses
        // whatever session the default browser already has live for a
        // different account.
        authorizeUrl.searchParams.set("prompt", "login");
        const href = authorizeUrl.toString();
        say("");
        say("Open this URL in your browser to sign in:");
        say(`  ${href}`);
        say("");
        if (useBrowser) {
          say("Opening your browser…");
          openBrowser(href);
        }
        say("Waiting for you to finish signing in…");
      });
    },
  );

  const tokenRes = await fetch(`${baseUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: BUSABASE_CLI_CLIENT_ID,
      client_platform: CLI_CLIENT_PLATFORM,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      state,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (HTTP ${tokenRes.status})${text ? `: ${text}` : ""}`);
  }
  const payload = (await tokenRes.json()) as {
    token?: string;
    accessToken?: string;
    apiKey?: string;
    expiresAt?: string | null;
  };
  // cli-consent authorizations return a long-lived `apiKey` (sk_…) instead of a
  // session token — same credential slot, just a different prefix at runtime.
  const token = payload.apiKey ?? payload.token ?? payload.accessToken;
  if (!token) throw new Error("Token exchange returned no credential.");
  return payload.apiKey
    ? { token, apiKeyExpiresAt: payload.expiresAt ?? undefined }
    : { token, expiresAt: payload.expiresAt ?? undefined };
}

interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

interface DeviceTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

const delay = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

async function readDeviceResponse(response: Response): Promise<DeviceTokenResponse> {
  return (await response.json().catch(() => ({}))) as DeviceTokenResponse;
}

/** RFC 8628 login: no local callback and no credential ever written to output. */
async function deviceLogin(
  baseUrl: string,
  useBrowser: boolean,
): Promise<{ token: string; apiKeyExpiresAt?: string }> {
  const origin = new URL(baseUrl).origin;
  let codeResponse: Response;
  try {
    codeResponse = await fetch(`${baseUrl}/api/auth/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        client_id: BUSABASE_CLI_CLIENT_ID,
        scope: "openid profile email",
      }),
    });
  } catch {
    throw new Error(`Could not start device sign-in because ${baseUrl} could not be reached.`);
  }

  const code = (await codeResponse.json().catch(() => ({}))) as DeviceCodeResponse & {
    error_description?: string;
  };
  if (!codeResponse.ok) {
    throw new Error(
      `Could not start device sign-in (HTTP ${codeResponse.status})${code.error_description ? `: ${code.error_description}` : "."}`,
    );
  }
  if (!code.device_code || !code.user_code || !code.verification_uri) {
    throw new Error("Device sign-in returned an incomplete authorization response.");
  }

  const verificationUrl = code.verification_uri_complete ?? code.verification_uri;
  say("");
  say("Authorize Busabase CLI in any browser:");
  say(`  ${code.verification_uri}`);
  say(`  Code: ${code.user_code}`);
  say("");
  if (useBrowser) openBrowser(verificationUrl);
  say("Waiting for authorization…");

  const expiresInSeconds = Math.max(1, code.expires_in ?? 15 * 60);
  const deadline = Date.now() + expiresInSeconds * 1000;
  let intervalSeconds = Math.max(1, code.interval ?? 5);
  let consecutiveNetworkFailures = 0;

  while (Date.now() < deadline) {
    await delay(intervalSeconds * 1000);
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(`${baseUrl}/api/auth/device/token`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: code.device_code,
          client_id: BUSABASE_CLI_CLIENT_ID,
        }),
      });
      consecutiveNetworkFailures = 0;
    } catch {
      consecutiveNetworkFailures += 1;
      if (consecutiveNetworkFailures >= 3) {
        throw new Error(
          "Device sign-in lost its network connection. Check connectivity and run `busabase-cli login` again.",
        );
      }
      continue;
    }

    const payload = await readDeviceResponse(tokenResponse);
    if (tokenResponse.ok && payload.access_token) {
      const finalizeResponse = await fetch(`${baseUrl}/api/v1/device/finalize`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${payload.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ deviceCode: code.device_code }),
      });
      const finalized = (await finalizeResponse.json().catch(() => ({}))) as {
        apiKey?: string;
        expiresAt?: string | null;
        credentialType?: string;
        error?: string | { message?: string };
        message?: string;
      };
      if (!finalizeResponse.ok || !finalized.apiKey || finalized.credentialType !== "api_key") {
        const finalizeError =
          typeof finalized.error === "string"
            ? finalized.error
            : (finalized.error?.message ?? finalized.message);
        throw new Error(
          `Device sign-in could not finalize the selected API key${finalizeError ? `: ${finalizeError}` : ` (HTTP ${finalizeResponse.status})`}.`,
        );
      }
      return {
        token: finalized.apiKey,
        apiKeyExpiresAt: finalized.expiresAt ?? undefined,
      };
    }

    switch (payload.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        intervalSeconds += 5;
        continue;
      case "access_denied":
        throw new Error("Device sign-in was denied. No credential was saved.");
      case "expired_token":
        throw new Error("The device code expired. Run `busabase-cli login` to request a new one.");
      default:
        throw new Error(
          `Device sign-in failed${payload.error_description ? `: ${payload.error_description}` : ` (HTTP ${tokenResponse.status})`}.`,
        );
    }
  }

  throw new Error("The device code expired. Run `busabase-cli login` to request a new one.");
}

/** POST the current session token to `/api/oauth/refresh`; returns the slid-forward token. */
async function refreshToken(
  baseUrl: string,
  token: string,
): Promise<{ token: string; expiresAt?: string }> {
  const res = await fetch(`${baseUrl}/api/oauth/refresh`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("SESSION_EXPIRED");
  if (!res.ok) throw new Error(`Refresh failed (HTTP ${res.status}) from ${baseUrl}.`);
  const payload = (await res.json()) as {
    token?: string;
    accessToken?: string;
    expiresAt?: string;
  };
  // The refresh slides the same token forward; fall back to the current one just in case.
  return { token: payload.token ?? payload.accessToken ?? token, expiresAt: payload.expiresAt };
}

// ── Space selection ───────────────────────────────────────────────────────────

async function pickSpaceId(verify: AuthVerify, preselected?: string): Promise<string | undefined> {
  if (preselected) return preselected;
  const spaces = verify.spaces ?? [];
  if (spaces.length <= 1) return verify.space?.id ?? spaces[0]?.id;
  if (!isInteractive()) {
    const choices = spaces.map((space) => `${space.name} [${space.id}]`).join(", ");
    throw new Error(
      `You belong to ${spaces.length} spaces; pass --space-id <id> to choose one. Available spaces: ${choices}`,
    );
  }
  say("");
  say("Which space should this CLI target?");
  spaces.forEach((space, index) => {
    const marker = space.id === verify.space?.id ? " (default)" : "";
    say(`  ${index + 1}. ${space.name}${marker}  [${space.id}]`);
  });
  const answer = await ask(`Choose 1-${spaces.length} (Enter for default): `);
  if (!answer) return verify.space?.id ?? spaces[0]?.id;
  const choice = Number(answer);
  if (Number.isInteger(choice) && choice >= 1 && choice <= spaces.length) {
    return spaces[choice - 1]?.id;
  }
  throw new Error("Not a valid space choice. Re-run login and choose one of the listed spaces.");
}

// ── Entry points ──────────────────────────────────────────────────────────────

interface LoginTarget {
  baseUrl: string;
  method: "none" | "device" | "loopback-oauth" | "api-key";
}

/**
 * Interactive "where is your Busabase?" menu. Every option resolves to the same two
 * axes: which base URL, and how (if at all) to obtain a token — the rest of login just
 * writes that to ~/.busabase/.env.
 */
async function chooseTarget(): Promise<LoginTarget> {
  const cloud = normalizeBaseUrl(DEFAULT_BASE_URL);
  say("Busabase is an approval-first database and knowledge base for AI agents.");
  say("Agents propose changes; humans review and merge what becomes trusted data.");
  say("This login connects the CLI to the Busabase instance you want to use.");
  say("");
  say("How should this CLI connect?");
  say("  1. Local/Desktop on this computer — no account, no login");
  say("     Use when you run `busabase server` or the Busabase Desktop app locally.");
  say("  2. Busabase Cloud — device sign-in (recommended)");
  say("     Works locally, over SSH, and in containers; approve from any browser.");
  say("  3. Busabase Cloud — paste an API key");
  say("     Best for CI, servers, or agents where a browser is not available.");
  say("  4. Self-hosted Busabase — device sign-in");
  say("     Use your team's Busabase URL when it supports device authorization.");
  say("  5. Self-hosted Busabase — paste an API key");
  say("     Use your team's Busabase URL with a long-lived key for automation.");
  const choice = await ask("Choose 1-5 [2]: ");

  const askSelfHostedUrl = async (): Promise<string> => {
    const url = await ask("Self-hosted base URL (e.g. https://busabase.example.com): ");
    if (!url) throw new Error("A self-hosted base URL is required.");
    return url;
  };

  switch (choice) {
    case "1": {
      const url = (await ask(`Local server URL [${DEFAULT_LOCAL_URL}]: `)) || DEFAULT_LOCAL_URL;
      return { baseUrl: url, method: "none" };
    }
    case "3":
      return { baseUrl: cloud, method: "api-key" };
    case "4":
      return { baseUrl: await askSelfHostedUrl(), method: "device" };
    case "5":
      return { baseUrl: await askSelfHostedUrl(), method: "api-key" };
    default:
      return { baseUrl: cloud, method: "device" };
  }
}

/** Resolve the target (base URL + method), obtain a credential, verify, pick a space, persist. */
export async function runLogin(options: LoginOptions): Promise<Record<string, string>> {
  let baseUrl = normalizeBaseUrl(options.baseUrl);
  let apiKey = options.apiKey;

  // Flags are express lanes; otherwise the interactive menu picks base URL + method.
  let method: LoginTarget["method"];
  if (apiKey) {
    method = "api-key";
  } else if (options.deviceCode) {
    method = "device";
  } else if (options.oauth) {
    method = "loopback-oauth";
  } else if (isInteractive()) {
    const target = await chooseTarget();
    baseUrl = normalizeBaseUrl(target.baseUrl);
    method = target.method;
  } else {
    // No TTY and no flags: connect to a local host, else default to Cloud OAuth.
    method = isLocalHost(baseUrl) ? "none" : "device";
  }

  // "Personal Desktop / local" (any open server): no account — just save the connection.
  if (method === "none") {
    if (await probeAuthRequired(baseUrl)) {
      throw new Error(
        `${baseUrl} requires sign-in. Re-run \`busabase-cli login\` and pick a Cloud or self-hosted option (OAuth or API key).`,
      );
    }
    writeDotEnvFile({
      BUSABASE_BASE_URL: baseUrl,
      BUSABASE_API_KEY: null,
      BUSABASE_SPACE_ID: null,
      [EXPIRES_AT_KEY]: null,
    });
    say(`✓ Connected to ${baseUrl} — open server, no login needed.`);
    say(`  Saved to ${dotEnvPath()}. Try: busabase-cli bases list`);
    return { status: "connected (no auth)", baseUrl, config: dotEnvPath() };
  }

  let token: string;
  // Only session expiry belongs in BUSABASE_TOKEN_EXPIRES_AT. API keys can have
  // their own expiry, but they are never refreshable OAuth sessions.
  let expiresAt: string | undefined;
  let apiKeyExpiresAt: string | undefined;
  if (method === "device") {
    const result = await deviceLogin(baseUrl, options.browser);
    token = result.token;
    apiKeyExpiresAt = result.apiKeyExpiresAt;
  } else if (method === "loopback-oauth") {
    const result = await loopbackOauthLogin(baseUrl, options.browser);
    token = result.token;
    expiresAt = result.expiresAt;
    apiKeyExpiresAt = result.apiKeyExpiresAt;
  } else {
    if (!apiKey) {
      say("Create a key in the dashboard → Settings → API Keys (shown once).");
      apiKey = await ask("Paste your API key (sk_…): ");
    }
    if (!apiKey) throw new Error("No API key provided.");
    token = apiKey;
  }

  say("Verifying…");
  const verify = await verifyAuth(baseUrl, token);
  const spaceId = await pickSpaceId(verify, options.spaceId);

  writeDotEnvFile({
    BUSABASE_BASE_URL: baseUrl,
    BUSABASE_API_KEY: token,
    BUSABASE_SPACE_ID: spaceId ?? null,
    // Clear any stale expiry when switching to an API key.
    [EXPIRES_AT_KEY]: expiresAt ?? null,
  });

  say("");
  say(`✓ Signed in and saved to ${dotEnvPath()}`);

  return {
    status: "signed in",
    method: method === "loopback-oauth" ? "oauth" : method,
    credentialType: method === "device" ? "api_key" : expiresAt ? "session" : "api_key",
    user: verify.user?.email ?? verify.user?.name ?? verify.user?.id ?? "(unknown)",
    space: spaceId ?? "(server default)",
    createdSpace: String(Boolean(verify.createdSpace)),
    bootstrapRequired: String(Boolean(verify.bootstrapRequired)),
    expiresAt: expiresAt ?? apiKeyExpiresAt ?? "(no expiry — API key)",
    baseUrl,
    config: dotEnvPath(),
  };
}

/**
 * `busabase-cli login --refresh` — slide the saved OAuth session forward without a
 * browser. No-op for API keys (including keys with a fixed expiry) because they
 * cannot be refreshed. An already-expired session must sign in again.
 */
export async function runRefresh(options: LogoutOptions): Promise<Record<string, string>> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const token = options.apiKey;
  if (!token) throw new Error("Not signed in — run `busabase-cli login` first.");
  const file = loadDotEnvFile();
  const isSavedExpiringSession =
    file.BUSABASE_API_KEY === token && Boolean(file.BUSABASE_TOKEN_EXPIRES_AT);
  if (!token.startsWith(LEGACY_SESSION_TOKEN_PREFIX) && !isSavedExpiringSession) {
    return {
      status: "nothing to refresh",
      detail: "This credential is an API key and cannot be refreshed. Only OAuth sessions refresh.",
    };
  }

  let refreshed: { token: string; expiresAt?: string };
  try {
    refreshed = await refreshToken(baseUrl, token);
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_EXPIRED") {
      throw new Error(
        "Your login session has expired — run `busabase-cli login` to sign in again.",
      );
    }
    throw error;
  }

  writeDotEnvFile({
    BUSABASE_API_KEY: refreshed.token,
    [EXPIRES_AT_KEY]: refreshed.expiresAt ?? null,
  });
  say(`✓ Session refreshed${refreshed.expiresAt ? ` — valid until ${refreshed.expiresAt}` : ""}`);

  return {
    status: "refreshed",
    expiresAt: refreshed.expiresAt ?? "(unknown)",
    config: dotEnvPath(),
  };
}

/**
 * Built-in auto-refresh, called before every data command. When the saved credential
 * is an OAuth session token within {@link AUTO_REFRESH_THRESHOLD_MS} of expiry, slide
 * it forward silently so an actively-used CLI never gets logged out mid-use.
 *
 * Best-effort and side-effect-only: never throws, and only touches the file-stored
 * session (not a token supplied via `--api-key`/exported env). Because refresh keeps
 * the SAME token, the caller's in-memory credential stays valid — only the on-disk
 * expiry advances. A truly-dead session is left alone and surfaces as the command's
 * own 401 (which points the user at `login`).
 */
export async function maybeAutoRefresh(baseUrl: string, apiKey?: string): Promise<void> {
  if (!apiKey) return;
  const file = loadDotEnvFile();
  if (file.BUSABASE_API_KEY !== apiKey) return; // token came from a flag/env, not our file
  const expiresRaw = file[EXPIRES_AT_KEY];
  if (!expiresRaw) return;
  const expiresAt = Date.parse(expiresRaw);
  if (Number.isNaN(expiresAt)) return;
  if (expiresAt <= Date.now()) return;
  if (expiresAt - Date.now() > AUTO_REFRESH_THRESHOLD_MS) return;

  try {
    const refreshed = await refreshToken(normalizeBaseUrl(baseUrl), apiKey);
    writeDotEnvFile({
      BUSABASE_API_KEY: refreshed.token,
      [EXPIRES_AT_KEY]: refreshed.expiresAt ?? null,
    });
  } catch {
    // Best effort — leave the credential as-is; a dead session shows up as a 401.
  }
}

/** Fail before a data command when the file-stored login session is already expired. */
export function assertCredentialNotExpired(apiKey?: string): void {
  if (!apiKey) return;
  const file = loadDotEnvFile();
  if (file.BUSABASE_API_KEY !== apiKey) return;
  const expiresRaw = file[EXPIRES_AT_KEY];
  if (!expiresRaw) return;
  const expiresAt = Date.parse(expiresRaw);
  if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
    throw new Error(
      "Your saved device login has expired. Run `busabase-cli login --device-code` to authorize this CLI again.",
    );
  }
}

/** Revoke a saved OAuth session (best effort) and clear the credential from disk. */
export async function runLogout(options: LogoutOptions): Promise<Record<string, string>> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const token = options.apiKey;
  let revoked = "no session to revoke";

  const file = loadDotEnvFile();
  // BUSABASE_TOKEN_EXPIRES_AT is session-only; an API key's own expiry is not stored here.
  if (
    token &&
    (token.startsWith(LEGACY_SESSION_TOKEN_PREFIX) ||
      (file.BUSABASE_API_KEY === token && file[EXPIRES_AT_KEY]))
  ) {
    try {
      const res = await fetch(`${baseUrl}/api/oauth/revoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      revoked = res.ok ? "session revoked" : `revoke returned HTTP ${res.status}`;
    } catch {
      revoked = "revoke request failed (cleared locally anyway)";
    }
  } else if (token) {
    revoked = "API key cleared locally (revoke it in the dashboard to disable it)";
  }

  writeDotEnvFile({ BUSABASE_API_KEY: null, BUSABASE_SPACE_ID: null, [EXPIRES_AT_KEY]: null });
  say(`✓ Cleared the saved credential from ${dotEnvPath()}`);

  return { status: "signed out", detail: revoked, config: dotEnvPath() };
}
