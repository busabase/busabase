import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline/promises";
import { normalizeBaseUrl } from "busabase-sdk";
import { dotEnvPath, loadDotEnvFile, writeDotEnvFile } from "./config-file.js";

/**
 * `busabase-cli login` — sign in and persist credentials to `~/.busabase/.env`, so
 * every later CLI/SDK call and the installed `busabase` skill authenticate with no
 * further prompts. Two methods, like `claude` login:
 *
 *   - **OAuth (preferred)**: opens the browser to Busabase Cloud's PKCE
 *     authorization endpoint, catches the redirect on a loopback server, and
 *     exchanges the code for a native session token (`bss_…`). No key to copy.
 *   - **API key**: paste (or pass `--api-key`) an `sk_…` key from the dashboard.
 *
 * Both end the same way: verify against `/api/v1/auth`, pick the target space, and
 * write `BUSABASE_BASE_URL` / `BUSABASE_API_KEY` / `BUSABASE_SPACE_ID`.
 */

const CLI_CLIENT_ID = "busabase-cli";
const CLI_CLIENT_PLATFORM = "cli";
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** Env key holding the OAuth session expiry (ISO), used to drive built-in auto-refresh. */
const EXPIRES_AT_KEY = "BUSABASE_TOKEN_EXPIRES_AT";
/** Native login session tokens carry this prefix; API keys (`sk_…`) do not expire. */
const SESSION_TOKEN_PREFIX = "bss_";
/** Auto-refresh a login session once it's within this window of expiry. */
const AUTO_REFRESH_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

export interface LoginOptions {
  baseUrl: string;
  /** Global `--api-key`; when present, login runs the non-interactive API-key path. */
  apiKey?: string;
  spaceId?: string;
  /** `--oauth` forces the browser flow (skips the method prompt). */
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
}

const base64url = (buffer: Buffer): string => buffer.toString("base64url");

const isInteractive = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY);

/** Progress/prompts go to stderr so `--output json` keeps stdout a clean result. */
const say = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

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
async function oauthLogin(
  baseUrl: string,
  useBrowser: boolean,
): Promise<{ token: string; expiresAt?: string }> {
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
        authorizeUrl.searchParams.set("client_id", CLI_CLIENT_ID);
        authorizeUrl.searchParams.set("client_platform", CLI_CLIENT_PLATFORM);
        authorizeUrl.searchParams.set("code_challenge", codeChallenge);
        authorizeUrl.searchParams.set("code_challenge_method", "S256");
        authorizeUrl.searchParams.set("redirect_uri", redirect);
        authorizeUrl.searchParams.set("state", state);
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
      client_id: CLI_CLIENT_ID,
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
    expiresAt?: string;
  };
  const token = payload.token ?? payload.accessToken;
  if (!token) throw new Error("Token exchange returned no session token.");
  return { token, expiresAt: payload.expiresAt };
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
    say(
      `You belong to ${spaces.length} spaces; defaulting to "${verify.space?.name ?? verify.space?.id}". Re-run with --space-id <id> to target another.`,
    );
    return verify.space?.id;
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
  say("Not a valid choice — using the default space.");
  return verify.space?.id ?? spaces[0]?.id;
}

// ── Entry points ──────────────────────────────────────────────────────────────

/** Resolve the sign-in method, obtain a credential, verify, pick a space, persist. */
export async function runLogin(options: LoginOptions): Promise<Record<string, string>> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  // Decide the method: explicit --api-key or --oauth win; otherwise ask (or default
  // to OAuth when there's no TTY to ask on).
  let method: "oauth" | "api-key";
  let apiKey = options.apiKey;
  if (apiKey) method = "api-key";
  else if (options.oauth) method = "oauth";
  else if (isInteractive()) {
    say(`Sign in to Busabase (${baseUrl})`);
    say("  1. Browser sign-in (OAuth) — recommended");
    say("  2. Paste an API key");
    const answer = await ask("Choose 1 or 2 [1]: ");
    method = answer === "2" ? "api-key" : "oauth";
  } else {
    method = "oauth";
  }

  let token: string;
  // OAuth sessions expire (and auto-refresh); API keys don't, so leave it unset.
  let expiresAt: string | undefined;
  if (method === "oauth") {
    const result = await oauthLogin(baseUrl, options.browser);
    token = result.token;
    expiresAt = result.expiresAt;
  } else {
    if (!apiKey) {
      say("Create a key at Dashboard → Settings → API Keys (it's shown once).");
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
    method,
    user: verify.user?.email ?? verify.user?.name ?? verify.user?.id ?? "(unknown)",
    space: spaceId ?? "(server default)",
    expiresAt: expiresAt ?? "(no expiry — API key)",
    baseUrl,
    config: dotEnvPath(),
  };
}

/**
 * `busabase-cli login --refresh` — slide the saved OAuth session forward without a
 * browser. No-op for API keys (they don't expire). An already-expired session can't
 * refresh itself, so we tell the user to `login` again.
 */
export async function runRefresh(options: LogoutOptions): Promise<Record<string, string>> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const token = options.apiKey;
  if (!token) throw new Error("Not signed in — run `busabase-cli login` first.");
  if (!token.startsWith(SESSION_TOKEN_PREFIX)) {
    return {
      status: "nothing to refresh",
      detail: "This credential is an API key, which doesn't expire. Only OAuth sessions refresh.",
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
  if (!apiKey?.startsWith(SESSION_TOKEN_PREFIX)) return;
  const file = loadDotEnvFile();
  if (file.BUSABASE_API_KEY !== apiKey) return; // token came from a flag/env, not our file
  const expiresRaw = file[EXPIRES_AT_KEY];
  if (!expiresRaw) return;
  const expiresAt = Date.parse(expiresRaw);
  if (Number.isNaN(expiresAt)) return;
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

/** Revoke a saved OAuth session (best effort) and clear the credential from disk. */
export async function runLogout(options: LogoutOptions): Promise<Record<string, string>> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const token = options.apiKey;
  let revoked = "no session to revoke";

  // Only native session tokens are revocable server-side; API keys are managed in
  // the dashboard, so we just drop them from the local config.
  if (token?.startsWith("bss_")) {
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
