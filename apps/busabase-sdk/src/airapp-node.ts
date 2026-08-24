import {
  BUSABASE_AIRAPP_CLIENT_ID,
  BusabaseOAuthError,
  type BusabaseOAuthRequest,
  createBusabaseOAuthRequest,
  exchangeBusabaseOAuthCode,
  parseBusabaseOAuthCallback,
  registerBusabaseAirAppOAuthClient,
} from "./oauth.js";
import {
  type BusabaseAirAppCredentialStoreOptions,
  getBusabaseAirAppAccessToken,
  loadBusabaseAirAppDynamicClientId,
  loadBusabaseAirAppOAuthCredential,
  revokeBusabaseAirAppOAuthCredential,
  storeBusabaseAirAppDynamicClientId,
  storeBusabaseAirAppOAuthCredential,
  storeBusabaseAirAppSelectedSpace,
} from "./oauth-node.js";

const DEFAULT_CLOUD_BASE_URL = "https://busabase.com";
const DEFAULT_PENDING_TTL_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * The env var Busabase injects into every AirApp process it spawns. Nobody else
 * sets it, which is what makes its **absence** the positive fact "standalone".
 */
export const BUSABASE_AIRAPP_RUNTIME_ENV = "BUSABASE_AIRAPP_RUNTIME";

/**
 * Every runtime Busabase hosts an AirApp in, as known to *this* SDK version.
 *
 * **Informational. Not what decides whether an app is hosted.** That separation
 * is the whole point of this constant existing here rather than being pasted
 * into each app, and getting it backwards is a bug we have already shipped once:
 * every generated AirApp used to carry its own hardcoded copy of this list and
 * answer `hosted` from membership in it. When the `local-node` engine was
 * renamed to `local`, all of them started answering "standalone" *inside a
 * hosted preview* — showing their own connection gate, calling `/api/v1` with no
 * credential, and leaving the operator with nothing to act on.
 *
 * Moving the list into the SDK does not by itself fix that. An app pins an SDK
 * version, so a list that gates behaviour would simply rot on a slower clock:
 * add an engine, and every app on an older SDK is wrong again until it upgrades.
 *
 * So the list names runtimes; {@link isBusabaseAirAppHosted} decides hosting,
 * from presence alone, and needs no upgrade to stay correct.
 */
export const BUSABASE_AIRAPP_RUNTIMES = ["nodepod", "local", "srt", "sandock", "embed"] as const;

export type BusabaseAirAppRuntime = (typeof BUSABASE_AIRAPP_RUNTIMES)[number];

/** Read the injected runtime, normalised. `""` means nobody hosted this process. */
export const readBusabaseAirAppRuntime = (
  env: Record<string, string | undefined> = process.env,
): string => (env[BUSABASE_AIRAPP_RUNTIME_ENV] || "").trim();

/**
 * Whether Busabase is hosting this process.
 *
 * Presence, never membership — see {@link BUSABASE_AIRAPP_RUNTIMES}. An engine
 * this SDK has never heard of still means "Busabase spawned me", because only
 * Busabase sets the variable at all.
 */
export const isBusabaseAirAppHosted = (runtime: string = readBusabaseAirAppRuntime()): boolean =>
  runtime.trim() !== "";

/**
 * Narrow a runtime string to one this SDK knows, or `null`.
 *
 * For code that wants to *branch* on a specific engine — an app that renders
 * differently under a public embed, say. Deliberately returns `null` rather than
 * throwing on an unknown value: a newer Busabase naming an engine this SDK
 * predates is normal, not an error, and the caller should fall back to generic
 * behaviour rather than break.
 */
export const asKnownBusabaseAirAppRuntime = (runtime: string): BusabaseAirAppRuntime | null =>
  (BUSABASE_AIRAPP_RUNTIMES as readonly string[]).includes(runtime)
    ? (runtime as BusabaseAirAppRuntime)
    : null;

export const BUSABASE_AIRAPP_GATEWAY_REASONS = {
  authRequired: "AUTH_REQUIRED",
  authUnavailable: "AUTH_UNAVAILABLE",
  connectionRequired: "CONNECTION_REQUIRED",
  oauthCallbackInvalid: "OAUTH_CALLBACK_INVALID",
  spaceNotAllowed: "SPACE_NOT_ALLOWED",
  spaceSelectionRequired: "SPACE_SELECTION_REQUIRED",
} as const;

type GatewayReason =
  (typeof BUSABASE_AIRAPP_GATEWAY_REASONS)[keyof typeof BUSABASE_AIRAPP_GATEWAY_REASONS];

interface AuthSpace {
  id: string;
  name: string;
  slug?: string | null;
  plan?: string | null;
}

interface AuthInfo {
  space: AuthSpace;
  spaces: AuthSpace[];
  [key: string]: unknown;
}

interface PendingOAuth extends BusabaseOAuthRequest {
  expiresAt: number;
}

interface GatewayTarget {
  baseUrl: string;
  accessToken: string;
  selectedSpace?: AuthSpace;
  source: "airapp-oauth-local" | "environment" | "open-server";
}

export interface BusabaseAirAppLocalGatewayOptions {
  appId: string;
  cloudBaseUrl?: string;
  clientId?: string;
  environment?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
  oauthPendingTtlMs?: number;
  requestTimeoutMs?: number;
  credentialStore?: BusabaseAirAppCredentialStoreOptions;
  successPath?: string;
  errorPath?: string;
}

export interface BusabaseAirAppAuthStatus {
  connected: boolean;
  cloudBaseUrl: string;
  baseUrl?: string;
  source?: GatewayTarget["source"];
  readiness: "needs_connection" | "needs_auth" | "needs_space" | "ready" | "retry";
  action: "connect" | "reconnect" | "select_space" | "continue" | "retry";
  requiresSpace?: boolean;
  selectedSpace?: AuthSpace | null;
  space?: AuthSpace | null;
  spaces?: AuthSpace[];
  reason?: GatewayReason;
  message?: string;
}

const jsonError = (status: number, reason: GatewayReason, message: string, data?: object) =>
  Response.json(
    {
      error: message,
      code:
        status === 401
          ? "UNAUTHORIZED"
          : status === 403
            ? "FORBIDDEN"
            : status === 409
              ? "CONFLICT"
              : status === 503
                ? "SERVICE_UNAVAILABLE"
                : "BAD_REQUEST",
      data: { reason, ...data },
    },
    { status },
  );

// `new URL("http://[::1]:3000").hostname` keeps the brackets, so both spellings must be listed or
// an IPv6 dev server needlessly registers a dynamic client instead of using the shared one.
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "[::1]"];

const normalizeOrigin = (raw: string, fallback = DEFAULT_CLOUD_BASE_URL) => {
  const withoutApi = String(raw || fallback)
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/, "");
  let url: URL;
  try {
    url = new URL(withoutApi);
  } catch {
    throw new BusabaseOAuthError("invalid_base_url", "Busabase base URL is invalid");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new BusabaseOAuthError("invalid_base_url", "Busabase base URL must be an origin");
  }
  const loopback = LOOPBACK_HOSTNAMES.includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new BusabaseOAuthError(
      "invalid_base_url",
      "Busabase requires HTTPS except for a loopback development server",
    );
  }
  return url.origin;
};

const requestOrigin = (request: Request) => {
  const directOrigin = new URL(request.url).origin;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (!forwardedHost || !forwardedProto || !["http", "https"].includes(forwardedProto))
    return directOrigin;

  try {
    const forwardedOrigin = new URL(`${forwardedProto}://${forwardedHost}`).origin;
    const browserOrigin = request.headers.get("origin");
    // A browser request must corroborate the proxy headers. OAuth callbacks have no Origin,
    // and remain bound to the pending PKCE request by their one-time state value.
    return browserOrigin && browserOrigin !== forwardedOrigin ? directOrigin : forwardedOrigin;
  } catch {
    return directOrigin;
  }
};

const isLoopbackOrigin = (origin: string) => {
  const url = new URL(origin);
  return url.protocol === "http:" && LOOPBACK_HOSTNAMES.includes(url.hostname);
};

const assertSameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== requestOrigin(request)) {
    throw new BusabaseOAuthError("origin_mismatch", "Request origin did not match");
  }
};

const readInput = async (request: Request) => {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await request.json().catch(() => ({}))) as Record<string, unknown>;
  }
  const form = await request.formData().catch(() => new FormData());
  return Object.fromEntries(form.entries());
};

const safeSpaces = (spaces: AuthSpace[]) =>
  spaces.map(({ id, name, slug, plan }) => ({ id, name, slug, plan }));

export class BusabaseAirAppLocalGateway {
  readonly #options: Required<
    Pick<
      BusabaseAirAppLocalGatewayOptions,
      | "appId"
      | "cloudBaseUrl"
      | "clientId"
      | "oauthPendingTtlMs"
      | "requestTimeoutMs"
      | "successPath"
      | "errorPath"
    >
  > &
    BusabaseAirAppLocalGatewayOptions;
  readonly #pendingOAuth = new Map<string, PendingOAuth>();
  readonly #usesDefaultClient: boolean;
  #environmentSelectedSpace: AuthSpace | undefined;

  constructor(options: BusabaseAirAppLocalGatewayOptions) {
    this.#usesDefaultClient = !options.clientId;
    this.#options = {
      ...options,
      appId: options.appId,
      cloudBaseUrl: normalizeOrigin(options.cloudBaseUrl || DEFAULT_CLOUD_BASE_URL),
      clientId: options.clientId || BUSABASE_AIRAPP_CLIENT_ID,
      oauthPendingTtlMs: options.oauthPendingTtlMs ?? DEFAULT_PENDING_TTL_MS,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      successPath: options.successPath || "/",
      errorPath: options.errorPath || "/",
    };
  }

  get cloudBaseUrl() {
    return this.#options.cloudBaseUrl;
  }

  #fetch() {
    return this.#options.fetch ?? fetch;
  }

  #now() {
    return this.#options.now?.() ?? Date.now();
  }

  #environment() {
    return this.#options.environment ?? process.env;
  }

  async #target(): Promise<GatewayTarget | null> {
    const environment = this.#environment();
    if (environment.BUSABASE_BASE_URL) {
      const selectedSpaceId = environment.BUSABASE_SPACE_ID?.trim();
      return {
        baseUrl: normalizeOrigin(environment.BUSABASE_BASE_URL),
        accessToken: environment.BUSABASE_API_KEY || "",
        source: environment.BUSABASE_API_KEY ? "environment" : "open-server",
        ...(selectedSpaceId
          ? { selectedSpace: { id: selectedSpaceId, name: selectedSpaceId } }
          : this.#environmentSelectedSpace
            ? { selectedSpace: this.#environmentSelectedSpace }
            : {}),
      };
    }
    const credential = await getBusabaseAirAppAccessToken(
      this.#options.appId,
      this.#options.credentialStore,
      this.#fetch(),
    );
    return credential
      ? {
          baseUrl: credential.baseUrl,
          accessToken: credential.accessToken,
          source: "airapp-oauth-local",
          ...(credential.selectedSpace ? { selectedSpace: credential.selectedSpace } : {}),
        }
      : null;
  }

  async #authInfo(target: GatewayTarget, spaceId = ""): Promise<AuthInfo> {
    const headers = new Headers({ accept: "application/json" });
    if (target.accessToken) headers.set("authorization", `Bearer ${target.accessToken}`);
    if (spaceId) headers.set("x-busabase-space", spaceId);
    const response = await this.#fetch()(new URL("/api/v1/auth", target.baseUrl), {
      headers,
      signal: AbortSignal.timeout(this.#options.requestTimeoutMs),
    });
    if (!response.ok) {
      throw new BusabaseOAuthError(
        response.status === 401 ? "auth_required" : "auth_verification_failed",
        `Busabase auth verification failed (${response.status})`,
        response.status,
      );
    }
    const info = (await response.json()) as Partial<AuthInfo>;
    if (!Array.isArray(info.spaces)) {
      throw new BusabaseOAuthError(
        "invalid_auth_response",
        "Busabase auth response did not include Spaces",
      );
    }
    return info as AuthInfo;
  }

  #persistSelectedSpace(target: GatewayTarget, selectedSpace: AuthSpace | null) {
    if (target.source === "airapp-oauth-local") {
      storeBusabaseAirAppSelectedSpace(
        this.#options.appId,
        selectedSpace ? { id: selectedSpace.id, name: selectedSpace.name } : null,
        this.#options.credentialStore,
      );
    } else {
      this.#environmentSelectedSpace = selectedSpace || undefined;
    }
  }

  async status(): Promise<BusabaseAirAppAuthStatus> {
    let target: GatewayTarget | null = null;
    try {
      target = await this.#target();
      if (!target) {
        return {
          connected: false,
          cloudBaseUrl: this.cloudBaseUrl,
          readiness: "needs_connection",
          action: "connect",
          reason: BUSABASE_AIRAPP_GATEWAY_REASONS.connectionRequired,
        };
      }
      const info = await this.#authInfo(target);
      const spaces = safeSpaces(info.spaces);
      if (!spaces.length) {
        this.#persistSelectedSpace(target, null);
        return {
          connected: true,
          cloudBaseUrl: this.cloudBaseUrl,
          baseUrl: target.baseUrl,
          source: target.source,
          readiness: "needs_space",
          action: "retry",
          requiresSpace: true,
          selectedSpace: null,
          space: null,
          spaces,
          reason: BUSABASE_AIRAPP_GATEWAY_REASONS.spaceSelectionRequired,
          message: "This account has no accessible Busabase Space",
        };
      }
      const selectedSpaceId = target.selectedSpace?.id;
      let selected = selectedSpaceId
        ? spaces.find((space) => space.id === selectedSpaceId)
        : undefined;
      if (!selected && spaces.length === 1) selected = spaces[0];
      if (target.selectedSpace && !selected) this.#persistSelectedSpace(target, null);
      if (selected && selected.id !== selectedSpaceId) {
        await this.#authInfo(target, selected.id);
        this.#persistSelectedSpace(target, selected);
      }
      return {
        connected: true,
        cloudBaseUrl: this.cloudBaseUrl,
        baseUrl: target.baseUrl,
        source: target.source,
        readiness: selected ? "ready" : "needs_space",
        action: selected ? "continue" : "select_space",
        requiresSpace: !selected,
        selectedSpace: selected || null,
        space: selected || null,
        spaces,
        ...(selected ? {} : { reason: BUSABASE_AIRAPP_GATEWAY_REASONS.spaceSelectionRequired }),
      };
    } catch (error) {
      const authRequired = error instanceof BusabaseOAuthError && error.status === 401;
      return {
        connected: Boolean(target) && !authRequired,
        cloudBaseUrl: this.cloudBaseUrl,
        ...(target ? { baseUrl: target.baseUrl, source: target.source, requiresSpace: true } : {}),
        readiness: authRequired ? "needs_auth" : "retry",
        action: authRequired ? "reconnect" : "retry",
        reason: authRequired
          ? BUSABASE_AIRAPP_GATEWAY_REASONS.authRequired
          : BUSABASE_AIRAPP_GATEWAY_REASONS.authUnavailable,
        message: error instanceof Error ? error.message : "Busabase auth verification failed",
      };
    }
  }

  statusResponse = async () => Response.json(await this.status());

  /** Resolve the client for this callback, then probe the authorize endpoint with it. */
  async #startAuthorization(
    target: { appId: string; baseUrl: string; redirectUri: string },
    needsDynamicClient: boolean,
    forceRegistration: boolean,
  ) {
    let clientId = this.#options.clientId;
    let reusedStoredClient = false;
    if (needsDynamicClient) {
      const stored = forceRegistration
        ? null
        : loadBusabaseAirAppDynamicClientId(target, this.#options.credentialStore);
      if (stored) {
        clientId = stored;
        reusedStoredClient = true;
      } else {
        const registration = await registerBusabaseAirAppOAuthClient(target, this.#fetch());
        clientId = registration.clientId;
        storeBusabaseAirAppDynamicClientId({ ...target, clientId }, this.#options.credentialStore);
      }
    }
    const oauthRequest = await createBusabaseOAuthRequest({
      baseUrl: target.baseUrl,
      redirectUri: target.redirectUri,
      clientId,
    });
    const probe = await this.#fetch()(oauthRequest.authorizeUrl, {
      headers: { accept: "text/html" },
      redirect: "manual",
      signal: AbortSignal.timeout(this.#options.requestTimeoutMs),
    });
    return { oauthRequest, probe, reusedStoredClient };
  }

  start = async (request: Request): Promise<Response> => {
    try {
      assertSameOrigin(request);
      const body = await readInput(request);
      const baseUrl = normalizeOrigin(String(body.base_url || ""), this.cloudBaseUrl);
      const redirectUri = new URL("/auth/callback", requestOrigin(request)).toString();
      const needsDynamicClient =
        this.#usesDefaultClient && !isLoopbackOrigin(requestOrigin(request));
      const target = { appId: this.#options.appId, baseUrl, redirectUri };

      let attempt = await this.#startAuthorization(target, needsDynamicClient, false);
      // A stored client id can expire or be revoked server-side. Re-register once so the AirApp
      // heals itself instead of failing every connect from that point on.
      if (attempt.probe.status >= 400 && attempt.reusedStoredClient) {
        attempt = await this.#startAuthorization(target, needsDynamicClient, true);
      }
      const { oauthRequest, probe } = attempt;
      if (probe.status >= 400) {
        throw new BusabaseOAuthError(
          "oauth_unavailable",
          `Busabase OAuth is unavailable (${probe.status})`,
          probe.status,
        );
      }
      this.#pendingOAuth.set(oauthRequest.state, {
        ...oauthRequest,
        expiresAt: this.#now() + this.#options.oauthPendingTtlMs,
      });
      return Response.redirect(oauthRequest.authorizeUrl, 303);
    } catch (error) {
      const redirect = new URL(this.#options.errorPath, requestOrigin(request));
      redirect.searchParams.set(
        "oauth_error",
        error instanceof Error ? error.message : "Unable to start Busabase OAuth",
      );
      return Response.redirect(redirect, 303);
    }
  };

  callback = async (request: Request): Promise<Response> => {
    const callback = new URL(request.url);
    const state = callback.searchParams.get("state") || "";
    const pending = this.#pendingOAuth.get(state);
    this.#pendingOAuth.delete(state);
    try {
      if (!pending || pending.expiresAt <= this.#now()) {
        throw new BusabaseOAuthError("oauth_request_expired", "OAuth request expired");
      }
      const code = parseBusabaseOAuthCallback(callback.toString(), pending);
      const tokenSet = await exchangeBusabaseOAuthCode(pending, code, this.#fetch());
      storeBusabaseAirAppOAuthCredential(
        {
          appId: this.#options.appId,
          baseUrl: pending.baseUrl,
          clientId: pending.clientId,
          tokenSet,
        },
        this.#options.credentialStore,
      );
      return Response.redirect(new URL(this.#options.successPath, requestOrigin(request)), 303);
    } catch (error) {
      const redirect = new URL(this.#options.errorPath, requestOrigin(request));
      redirect.searchParams.set(
        "oauth_error",
        error instanceof Error ? error.message : "Busabase OAuth callback failed",
      );
      return Response.redirect(redirect, 303);
    }
  };

  selectSpace = async (request: Request): Promise<Response> => {
    try {
      assertSameOrigin(request);
      const body = await readInput(request);
      const spaceId = String(body.space_id || "").trim();
      const target = await this.#target();
      if (!target) {
        return jsonError(
          401,
          BUSABASE_AIRAPP_GATEWAY_REASONS.connectionRequired,
          "Connect Busabase before selecting a Space",
        );
      }
      const info = await this.#authInfo(target);
      const selected = info.spaces.find((space) => space.id === spaceId);
      if (!selected) {
        return jsonError(
          403,
          BUSABASE_AIRAPP_GATEWAY_REASONS.spaceNotAllowed,
          "The selected Space is not accessible to this account",
        );
      }
      await this.#authInfo(target, selected.id);
      this.#persistSelectedSpace(target, selected);
      return Response.json({ ok: true, space: { id: selected.id, name: selected.name } });
    } catch (error) {
      return jsonError(
        400,
        BUSABASE_AIRAPP_GATEWAY_REASONS.authUnavailable,
        error instanceof Error ? error.message : "Unable to select Busabase Space",
      );
    }
  };

  logout = async (request: Request): Promise<Response> => {
    try {
      assertSameOrigin(request);
      if (loadBusabaseAirAppOAuthCredential(this.#options.appId, this.#options.credentialStore)) {
        await revokeBusabaseAirAppOAuthCredential(
          this.#options.appId,
          this.#options.credentialStore,
          this.#fetch(),
        ).catch(() => undefined);
      }
      this.#environmentSelectedSpace = undefined;
      return Response.json({ ok: true });
    } catch (error) {
      return jsonError(
        400,
        BUSABASE_AIRAPP_GATEWAY_REASONS.authUnavailable,
        error instanceof Error ? error.message : "Unable to disconnect Busabase",
      );
    }
  };

  proxy = async (request: Request): Promise<Response> => {
    let target: GatewayTarget | null;
    try {
      target = await this.#target();
    } catch {
      return jsonError(
        401,
        BUSABASE_AIRAPP_GATEWAY_REASONS.authRequired,
        "Busabase authentication expired",
      );
    }
    if (!target) {
      return jsonError(
        401,
        BUSABASE_AIRAPP_GATEWAY_REASONS.connectionRequired,
        "Busabase connection required",
      );
    }
    let selectedSpace = target.selectedSpace;
    if (!selectedSpace) {
      try {
        const info = await this.#authInfo(target);
        if (info.spaces.length === 1) {
          selectedSpace = info.spaces[0];
          this.#persistSelectedSpace(target, selectedSpace);
        }
      } catch {
        return jsonError(
          503,
          BUSABASE_AIRAPP_GATEWAY_REASONS.authUnavailable,
          "Busabase authentication could not be verified",
        );
      }
    }
    if (!selectedSpace) {
      return jsonError(
        409,
        BUSABASE_AIRAPP_GATEWAY_REASONS.spaceSelectionRequired,
        "Busabase Space selection required",
      );
    }

    const incoming = new URL(request.url);
    const targetUrl = new URL(incoming.pathname + incoming.search, target.baseUrl);
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    const accept = request.headers.get("accept");
    if (contentType) headers.set("content-type", contentType);
    if (accept) headers.set("accept", accept);
    headers.set("x-busabase-space", selectedSpace.id);
    if (target.accessToken) headers.set("authorization", `Bearer ${target.accessToken}`);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    let upstream: Response;
    try {
      upstream = await this.#fetch()(targetUrl, {
        method: request.method,
        headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
        redirect: "manual",
      });
    } catch {
      return jsonError(
        503,
        BUSABASE_AIRAPP_GATEWAY_REASONS.authUnavailable,
        "Busabase API is temporarily unavailable",
      );
    }
    const responseHeaders = new Headers();
    const upstreamType = upstream.headers.get("content-type");
    if (upstreamType) responseHeaders.set("content-type", upstreamType);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  };
}

export const createBusabaseAirAppLocalGateway = (options: BusabaseAirAppLocalGatewayOptions) =>
  new BusabaseAirAppLocalGateway(options);
