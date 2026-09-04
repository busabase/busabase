import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline/promises";
import { BUSABASE_CLI_CLIENT_ID } from "busabase-contract/auth/device-authorization";
import { DEFAULT_BASE_URL, normalizeBaseUrl } from "busabase-sdk";
import { activeCredentialPath, loadDotEnvFile, writeDotEnvFile } from "./config-file.js";

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
 *
 * Device authorization additionally splits into a **two-turn agent flow**:
 * `--no-wait` starts it and returns the verification URL plus a resume code at
 * once (no blocking, no credential written), and `--resume-code <code>` finishes
 * it in a later invocation. This exists because many agent harnesses only relay
 * a turn's FINAL message — a URL printed mid-command while this process blocks
 * polling never reaches the user, so the blocking flow silently times out.
 */

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** Env key holding the OAuth access-token expiry (ISO), used to drive built-in auto-refresh. */
const EXPIRES_AT_KEY = "BUSABASE_TOKEN_EXPIRES_AT";
const REFRESH_TOKEN_KEY = "BUSABASE_REFRESH_TOKEN";
/** Auto-refresh an OAuth access token once it's within this window of expiry. */
const AUTO_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

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
  /** `--no-wait`: start a device sign-in and return immediately with a resume code. */
  noWait?: boolean;
  /** `--resume-code <code>`: finish a device sign-in started earlier with `--no-wait`. */
  resumeCode?: string;
  /** Active `--profile`, echoed into agent-facing resume/recovery commands only. */
  profile?: string;
}

export interface LogoutOptions {
  baseUrl: string;
  /** The currently-saved credential (OAuth access token or API key), for revocation. */
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
export const isLocalHost = (baseUrl: string): boolean => {
  try {
    const { hostname } = new URL(baseUrl);
    // `new URL("http://[::1]:port").hostname` keeps the brackets, so both forms must be listed
    // or a self-hosted server on IPv6 loopback wrongly takes the device-code login path instead
    // of connecting straight through as an open local server.
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
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
  const reportFailure = (): void => {
    say("Could not open a browser automatically. Open the URL above manually.");
  };
  try {
    const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
    child.once("error", reportFailure);
    child.unref();
  } catch {
    reportFailure();
  }
}

async function verifyAuth(baseUrl: string, token: string): Promise<AuthVerify> {
  const res = await fetch(`${baseUrl}/api/v1/auth`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    throw new Error(
      `The credential was rejected (401) by ${baseUrl}. If it's an API key, check it in Dashboard → Settings → API Keys; if it's an OAuth login, run \`busabase-cli login\` again.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Could not verify the credential (HTTP ${res.status}) from ${baseUrl}.`);
  }
  return (await res.json()) as AuthVerify;
}

// ── OAuth (PKCE loopback) ─────────────────────────────────────────────────────

/** Run the browser PKCE flow and return the OAuth access token (+ its expiry). */
async function loopbackOauthLogin(
  baseUrl: string,
  useBrowser: boolean,
): Promise<{ token: string; refreshToken?: string; expiresAt?: string; apiKeyExpiresAt?: string }> {
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
        const returnedIssuer = url.searchParams.get("iss");
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
        let issuerMatches = false;
        try {
          issuerMatches = Boolean(
            returnedIssuer && new URL(returnedIssuer).origin === new URL(baseUrl).origin,
          );
        } catch {
          issuerMatches = false;
        }
        if (!issuerMatches) {
          respond("Sign-in failed", "Authorization server mismatch. Close this tab and try again.");
          cleanup();
          reject(new Error("OAuth authorization server issuer mismatch."));
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
        authorizeUrl.searchParams.set("resource", `${baseUrl}/api/v1`);
        authorizeUrl.searchParams.set("scope", "api");
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
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: BUSABASE_CLI_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      resource: `${baseUrl}/api/v1`,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (HTTP ${tokenRes.status})${text ? `: ${text}` : ""}`);
  }
  const payload = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const token = payload.access_token;
  if (!token) throw new Error("Token exchange returned no credential.");
  return {
    token,
    refreshToken: payload.refresh_token,
    expiresAt:
      typeof payload.expires_in === "number"
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : undefined,
  };
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

/** Fallback lifetime for a device code when the server does not declare one. */
const DEVICE_CODE_TTL_SECONDS = 15 * 60;

interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** `verification_uri_complete` when given — the link to actually open. */
  verificationUrl: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

/** Step 1 of RFC 8628: ask the server for a device code + verification URL. */
async function requestDeviceAuthorization(baseUrl: string): Promise<DeviceAuthorization> {
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
  return {
    deviceCode: code.device_code,
    userCode: code.user_code,
    verificationUri: code.verification_uri,
    verificationUrl: code.verification_uri_complete ?? code.verification_uri,
    expiresInSeconds: Math.max(1, code.expires_in ?? DEVICE_CODE_TTL_SECONDS),
    intervalSeconds: Math.max(1, code.interval ?? 5),
  };
}

/**
 * Step 2 of RFC 8628: poll until the user approves, then finalize into an API
 * key. Callable on its own for `--resume-code` (the device code outlives this
 * process server-side, so resuming needs no new endpoint). `restartCommand`
 * names the exact command to rerun once a code has expired — a resumed sign-in
 * must not tell the user to plain "run login" and silently drop their flags.
 */
async function pollDeviceApiKey(
  baseUrl: string,
  auth: Pick<DeviceAuthorization, "deviceCode" | "intervalSeconds" | "expiresInSeconds">,
  restartCommand: string,
): Promise<{ token: string; apiKeyExpiresAt?: string }> {
  const origin = new URL(baseUrl).origin;
  const deadline = Date.now() + auth.expiresInSeconds * 1000;
  let intervalSeconds = auth.intervalSeconds;
  let consecutiveNetworkFailures = 0;
  // The CLI's poll and the browser's approve are independent requests with no session
  // affinity; a just-approved code can briefly still read back as pending. Purely
  // cosmetic — the loop already keeps retrying regardless — but without this the CLI
  // looks frozen right after someone approves in the browser, which reads as "stuck".
  let pendingPollCount = 0;
  let reassuredAfterApprovalHint = false;
  const REASSURE_AFTER_POLLS = 4; // ~20s at the default 5s interval

  while (Date.now() < deadline) {
    await delay(intervalSeconds * 1000);
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(`${baseUrl}/api/auth/device/token`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: auth.deviceCode,
          client_id: BUSABASE_CLI_CLIENT_ID,
        }),
      });
      consecutiveNetworkFailures = 0;
    } catch {
      consecutiveNetworkFailures += 1;
      if (consecutiveNetworkFailures >= 3) {
        throw new Error(
          `Device sign-in lost its network connection. Check connectivity and run \`${restartCommand}\` again.`,
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
        body: JSON.stringify({ deviceCode: auth.deviceCode }),
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
        pendingPollCount += 1;
        if (pendingPollCount >= REASSURE_AFTER_POLLS && !reassuredAfterApprovalHint) {
          reassuredAfterApprovalHint = true;
          say(
            "Still waiting… if you already approved in the browser, this can take a few extra seconds to register — no need to retry.",
          );
        }
        continue;
      case "slow_down":
        intervalSeconds += 5;
        continue;
      case "access_denied":
        throw new Error("Device sign-in was denied. No credential was saved.");
      case "expired_token":
        throw new Error(`The device code expired. Run \`${restartCommand}\` to request a new one.`);
      default:
        throw new Error(
          `Device sign-in failed${payload.error_description ? `: ${payload.error_description}` : ` (HTTP ${tokenResponse.status})`}.`,
        );
    }
  }

  throw new Error(`The device code expired. Run \`${restartCommand}\` to request a new one.`);
}

/** RFC 8628 login: no local callback and no credential ever written to output. */
async function deviceLogin(
  baseUrl: string,
  useBrowser: boolean,
  profile?: string,
): Promise<{ token: string; apiKeyExpiresAt?: string }> {
  const auth = await requestDeviceAuthorization(baseUrl);
  say("");
  say("Authorize Busabase CLI in any browser:");
  say(`  ${auth.verificationUri}`);
  say(`  Code: ${auth.userCode}`);
  say("");
  if (useBrowser) openBrowser(auth.verificationUrl);
  if (!isInteractive()) {
    // Piped / agent harness. If only a turn's final message reaches the user,
    // the URL above never will — point the agent at the two-turn flow instead.
    say(
      `[AI agent] This command blocks (up to ${Math.round(auth.expiresInSeconds / 60)} minutes) until the user approves in a browser. ` +
        "If your harness only delivers a turn's final message, the user will never see the URL above. Instead run " +
        `\`${buildLoginCommand(baseUrl, profile, "--no-wait --output json")}\`, send verification_url to the user as your final message, ` +
        "end the turn, and finish later with `--resume-code`. Do not restart login after showing the URL — a restart invalidates it.",
    );
  }
  say("Waiting for authorization…");
  return pollDeviceApiKey(baseUrl, auth, buildLoginCommand(baseUrl, profile, ""));
}

/** Exchange a rotating refresh token for a new OAuth token set. */
async function refreshToken(
  baseUrl: string,
  refreshToken: string,
): Promise<{ token: string; refreshToken?: string; expiresAt?: string }> {
  const res = await fetch(`${baseUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: BUSABASE_CLI_CLIENT_ID,
      resource: `${baseUrl}/api/v1`,
    }),
  });
  if (res.status === 400 || res.status === 401) throw new Error("SESSION_EXPIRED");
  if (!res.ok) throw new Error(`Refresh failed (HTTP ${res.status}) from ${baseUrl}.`);
  const payload = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) throw new Error("Refresh response had no access token");
  return {
    token: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt:
      typeof payload.expires_in === "number"
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : undefined,
  };
}

// ── Space selection ───────────────────────────────────────────────────────────

/**
 * Login never blocks on a Space question — interactive and non-interactive callers
 * get identical treatment. The server already resolves the best default (the
 * account's most recently active Space; see `resolveRecentSpaceIdForUser` on the
 * Cloud side), so the CLI just accepts it and tells the caller what else is
 * available, human or agent, so it can switch with `busabase-cli space use <id>`
 * without an extra round-trip through a terminal prompt that a script or an
 * agent's pseudo-TTY shell might never be able to answer.
 */
function pickSpaceId(verify: AuthVerify, preselected?: string): string | undefined {
  if (preselected) return preselected;
  const spaces = verify.spaces ?? [];
  const fallback = verify.space?.id ?? spaces[0]?.id;
  if (spaces.length <= 1) return fallback;
  const choices = spaces.map((space) => `${space.name} [${space.id}]`).join(", ");
  say(
    `Note: this account belongs to ${spaces.length} spaces; defaulted to "${verify.space?.name ?? spaces[0]?.name}". Run \`busabase-cli space use <id>\` to switch. Available: ${choices}`,
  );
  return fallback;
}

// ── Agent-facing recovery commands ────────────────────────────────────────────

/**
 * Assemble a copy-paste-runnable `busabase-cli login …` for THIS connection —
 * non-default base URL and active profile included — so an agent (or the JSON
 * error envelope) never hands the user a command that targets the wrong host
 * or the wrong account.
 */
export const buildLoginCommand = (
  baseUrl: string,
  profile: string | undefined,
  suffix: string,
): string => {
  const parts = ["busabase-cli login"];
  if (normalizeBaseUrl(baseUrl) !== normalizeBaseUrl(DEFAULT_BASE_URL)) {
    parts.push(`--base-url ${normalizeBaseUrl(baseUrl)}`);
  }
  if (profile) parts.push(`--profile ${profile}`);
  if (suffix) parts.push(suffix);
  return parts.join(" ");
};

/**
 * Machine-readable next step for an auth failure, attached to the JSON error
 * envelope (the human prose in `explainError` stays as-is). Written for an
 * agent recovering without a terminal: the two-turn device flow is the one
 * path that works when only a turn's final message reaches the user.
 */
export function authRecoveryHint(
  code: "UNAUTHORIZED" | "FORBIDDEN",
  baseUrl: string,
  profile?: string,
  endpoint?: { procedureId?: string; level?: string; declared?: boolean },
): string {
  if (code === "FORBIDDEN") {
    // When the failing command maps to one contract endpoint, the required level
    // comes from the same policy table the server gates on — so say which level,
    // instead of "ask an admin for more" and leaving them to guess how much more.
    const needed =
      endpoint?.procedureId && endpoint.level
        ? `\`${endpoint.procedureId}\` requires an API key at level \`${endpoint.level}\`${
            endpoint.declared ? "" : " (no explicit policy for it; the server fails closed to this)"
          }. Check yours with \`busabase-cli whoami\`. `
        : "";
    return (
      "The credential was accepted but lacks permission for this action. " +
      needed +
      "Confirm the target space (`busabase-cli space list`, then `busabase-cli space use <id>`), " +
      "or ask a space admin to issue a key at the level above. Note a `changeRequest`-level key " +
      "can propose but deliberately cannot merge its own proposal."
    );
  }
  const start = buildLoginCommand(baseUrl, profile, "--no-wait --output json");
  const resume = buildLoginCommand(baseUrl, profile, "--resume-code <resume_code>");
  return (
    `Run \`${start}\` to get verification_url and resume_code. Show verification_url to the user ` +
    "EXACTLY as returned (an opaque string — never re-encode, trim, or re-wrap it) and end this " +
    `turn so they can approve it on any device. After they confirm, run \`${resume}\` to finish ` +
    "signing in, then retry this command. Do not restart login after showing the URL — a restart " +
    "invalidates it. For headless automation, pass --api-key <token> from the environment instead."
  );
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
  say("Busabase is your AI agents' database, knowledge base, apps library, and skills registry.");
  say("Every change goes in as a change request, so it keeps a message, a diff, and a history.");
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

  if (options.noWait && apiKey) {
    throw new Error("--no-wait starts a device sign-in and cannot be combined with --api-key.");
  }
  if (options.noWait && options.resumeCode) {
    throw new Error(
      "--no-wait and --resume-code are the two halves of one sign-in — pass one, not both.",
    );
  }

  // Turn 1 of the two-turn agent flow: start device authorization and hand back
  // the verification URL plus a resume code, WITHOUT blocking and WITHOUT
  // writing any credential. Turn 2 is `--resume-code` below.
  if (options.noWait) {
    const auth = await requestDeviceAuthorization(baseUrl);
    const resume = buildLoginCommand(baseUrl, options.profile, `--resume-code ${auth.deviceCode}`);
    return {
      status: "authorization pending",
      verification_url: auth.verificationUrl,
      user_code: auth.userCode,
      resume_code: auth.deviceCode,
      expires_in: String(auth.expiresInSeconds),
      hint:
        "Show verification_url to the user EXACTLY as returned — it is an opaque string; never " +
        "re-encode, trim, or re-wrap it — then END THIS TURN so they can approve it on any device " +
        "(a QR code helps: `busabase-cli qrcode <verification_url> --out-file qr.png`). After the " +
        `user confirms, run \`${resume}\` to finish signing in. Do NOT start a new login in the ` +
        "meantime — a fresh login invalidates this link.",
    };
  }

  // Flags are express lanes; otherwise the interactive menu picks base URL + method.
  let method: LoginTarget["method"] | "device-resume";
  if (options.resumeCode) {
    method = "device-resume";
  } else if (apiKey) {
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
    say(`  Saved to ${activeCredentialPath()}. Try: busabase-cli bases list`);
    return { status: "connected (no auth)", baseUrl, config: activeCredentialPath() };
  }

  let token: string;
  // Only session expiry belongs in BUSABASE_TOKEN_EXPIRES_AT. API keys can have
  // their own expiry, but they are never refreshable OAuth token sets.
  let expiresAt: string | undefined;
  let apiKeyExpiresAt: string | undefined;
  let refreshTokenValue: string | undefined;
  if (method === "device") {
    const result = await deviceLogin(baseUrl, options.browser, options.profile);
    token = result.token;
    apiKeyExpiresAt = result.apiKeyExpiresAt;
  } else if (method === "device-resume") {
    // Turn 2: the device code from `--no-wait` is still pending server-side —
    // re-enter the poll loop with it, then persist exactly like a fresh login.
    say("Resuming device sign-in…");
    const result = await pollDeviceApiKey(
      baseUrl,
      {
        deviceCode: options.resumeCode ?? "",
        intervalSeconds: 5,
        expiresInSeconds: DEVICE_CODE_TTL_SECONDS,
      },
      buildLoginCommand(baseUrl, options.profile, "--no-wait"),
    );
    token = result.token;
    apiKeyExpiresAt = result.apiKeyExpiresAt;
  } else if (method === "loopback-oauth") {
    const result = await loopbackOauthLogin(baseUrl, options.browser);
    token = result.token;
    expiresAt = result.expiresAt;
    refreshTokenValue = result.refreshToken;
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
  const spaceId = pickSpaceId(verify, options.spaceId);

  writeDotEnvFile({
    BUSABASE_BASE_URL: baseUrl,
    BUSABASE_API_KEY: token,
    BUSABASE_SPACE_ID: spaceId ?? null,
    // Clear any stale expiry when switching to an API key.
    [EXPIRES_AT_KEY]: expiresAt ?? null,
    [REFRESH_TOKEN_KEY]: refreshTokenValue ?? null,
  });

  say("");
  say(`✓ Signed in and saved to ${activeCredentialPath()}`);

  return {
    status: "signed in",
    method: method === "loopback-oauth" ? "oauth" : method === "device-resume" ? "device" : method,
    credentialType:
      method === "device" || method === "device-resume"
        ? "api_key"
        : expiresAt
          ? "oauth"
          : "api_key",
    user: verify.user?.email ?? verify.user?.name ?? verify.user?.id ?? "(unknown)",
    space: spaceId ?? "(server default)",
    // Surfaced so a non-interactive caller (typically an agent) can see whether the
    // fallback default is the space it actually wants, and switch with `space use <id>`.
    availableSpaces: (verify.spaces ?? []).map((space) => `${space.name} [${space.id}]`).join(", "),
    createdSpace: String(Boolean(verify.createdSpace)),
    bootstrapRequired: String(Boolean(verify.bootstrapRequired)),
    expiresAt: expiresAt ?? apiKeyExpiresAt ?? "(no expiry — API key)",
    baseUrl,
    config: activeCredentialPath(),
  };
}

/**
 * `busabase-cli login --refresh` — rotate the saved OAuth token set without a
 * browser. No-op for API keys (including keys with a fixed expiry) because they
 * cannot be refreshed. An already-expired authorization must sign in again.
 */
export async function runRefresh(options: LogoutOptions): Promise<Record<string, string>> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const token = options.apiKey;
  if (!token) throw new Error("Not signed in — run `busabase-cli login` first.");
  const file = loadDotEnvFile();
  const isSavedExpiringOAuthToken =
    file.BUSABASE_API_KEY === token && Boolean(file.BUSABASE_TOKEN_EXPIRES_AT);
  if (!isSavedExpiringOAuthToken) {
    return {
      status: "nothing to refresh",
      detail:
        "This credential is an API key and cannot be refreshed. Only OAuth token sets refresh.",
    };
  }

  const savedRefreshToken = file[REFRESH_TOKEN_KEY];
  if (!savedRefreshToken) throw new Error("OAuth refresh token is missing — sign in again.");
  let refreshed: { token: string; refreshToken?: string; expiresAt?: string };
  try {
    refreshed = await refreshToken(baseUrl, savedRefreshToken);
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_EXPIRED") {
      throw new Error(
        "Your OAuth authorization has expired — run `busabase-cli login` to sign in again.",
      );
    }
    throw error;
  }

  writeDotEnvFile({
    BUSABASE_API_KEY: refreshed.token,
    [EXPIRES_AT_KEY]: refreshed.expiresAt ?? null,
    [REFRESH_TOKEN_KEY]: refreshed.refreshToken ?? null,
  });
  say(
    `✓ OAuth token refreshed${refreshed.expiresAt ? ` — valid until ${refreshed.expiresAt}` : ""}`,
  );

  return {
    status: "refreshed",
    expiresAt: refreshed.expiresAt ?? "(unknown)",
    config: activeCredentialPath(),
  };
}

/**
 * Built-in auto-refresh, called before every data command. When the saved credential
 * is an OAuth access token within {@link AUTO_REFRESH_THRESHOLD_MS} of expiry, rotate
 * it silently so an actively-used CLI never gets logged out mid-use.
 *
 * Best-effort: never throws, and only touches the file-stored OAuth token (not a token
 * supplied via `--api-key`/exported env). Returns the rotated access token so the
 * command currently being run uses the same credential that was persisted.
 */
export async function maybeAutoRefresh(
  baseUrl: string,
  apiKey?: string,
): Promise<string | undefined> {
  if (!apiKey) return undefined;
  const file = loadDotEnvFile();
  if (file.BUSABASE_API_KEY !== apiKey) return undefined; // token came from a flag/env, not our file
  const expiresRaw = file[EXPIRES_AT_KEY];
  if (!expiresRaw) return undefined;
  const expiresAt = Date.parse(expiresRaw);
  if (Number.isNaN(expiresAt)) return undefined;
  if (expiresAt - Date.now() > AUTO_REFRESH_THRESHOLD_MS) return undefined;

  try {
    const savedRefreshToken = file[REFRESH_TOKEN_KEY];
    if (!savedRefreshToken) return undefined;
    const refreshed = await refreshToken(normalizeBaseUrl(baseUrl), savedRefreshToken);
    writeDotEnvFile({
      BUSABASE_API_KEY: refreshed.token,
      [EXPIRES_AT_KEY]: refreshed.expiresAt ?? null,
      [REFRESH_TOKEN_KEY]: refreshed.refreshToken ?? null,
    });
    return refreshed.token;
  } catch {
    // Best effort — leave the credential as-is; an expired token shows up as a 401.
    return undefined;
  }
}

/** Fail before a data command when the file-stored OAuth access token is already expired. */
export function assertCredentialNotExpired(apiKey?: string): void {
  if (!apiKey) return;
  const file = loadDotEnvFile();
  if (file.BUSABASE_API_KEY !== apiKey) return;
  const expiresRaw = file[EXPIRES_AT_KEY];
  if (!expiresRaw) return;
  const expiresAt = Date.parse(expiresRaw);
  if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
    throw new Error(
      "Your saved OAuth login has expired. Run `busabase-cli login` to sign in again.",
    );
  }
}

/** Revoke a saved OAuth token family (best effort) and clear the credential from disk. */
export async function runLogout(options: LogoutOptions): Promise<Record<string, string>> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const token = options.apiKey;
  let revoked = "no OAuth token to revoke";

  const file = loadDotEnvFile();
  // BUSABASE_TOKEN_EXPIRES_AT is OAuth-only; an API key's own expiry is not stored here.
  if (token && file.BUSABASE_API_KEY === token && file[EXPIRES_AT_KEY]) {
    try {
      const tokenToRevoke = file[REFRESH_TOKEN_KEY] ?? token;
      const res = await fetch(`${baseUrl}/api/oauth/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokenToRevoke }),
      });
      revoked = res.ok ? "OAuth token family revoked" : `revoke returned HTTP ${res.status}`;
    } catch {
      revoked = "revoke request failed (cleared locally anyway)";
    }
  } else if (token) {
    revoked = "API key cleared locally (revoke it in the dashboard to disable it)";
  }

  writeDotEnvFile({
    BUSABASE_API_KEY: null,
    BUSABASE_SPACE_ID: null,
    [EXPIRES_AT_KEY]: null,
    [REFRESH_TOKEN_KEY]: null,
  });
  say(`✓ Cleared the saved credential from ${activeCredentialPath()}`);

  return { status: "signed out", detail: revoked, config: activeCredentialPath() };
}
