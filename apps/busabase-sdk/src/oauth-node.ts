import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  BUSABASE_AIRAPP_CLIENT_ID,
  BusabaseOAuthError,
  type BusabaseOAuthTokenSet,
  refreshBusabaseOAuthToken,
  revokeBusabaseOAuthToken,
} from "./oauth.js";
import { normalizeBaseUrl } from "./url.js";

const STORE_VERSION = 1;
const APP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REFRESH_WINDOW_MS = 60_000;
const refreshesByCredentialPath = new Map<string, Promise<BusabaseAirAppOAuthCredential>>();

export interface BusabaseAirAppOAuthCredential {
  version: 1;
  appId: string;
  baseUrl: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string[];
  tokenType: string;
  /** Validated target for this local AirApp. Tokens remain user-scoped. */
  selectedSpace?: {
    id: string;
    name: string;
  };
}

export interface BusabaseAirAppCredentialStoreOptions {
  /** Override only for tests or an explicitly isolated installation. */
  rootDir?: string;
}

const assertAppId = (appId: string) => {
  if (!APP_ID_RE.test(appId)) {
    throw new BusabaseOAuthError(
      "invalid_airapp_id",
      "AirApp id must use letters, digits, dot, dash, or underscore",
    );
  }
  return appId;
};

const storeRoot = (options: BusabaseAirAppCredentialStoreOptions = {}) =>
  options.rootDir ?? join(homedir(), ".busabase");

/** Directory containing one owner-only OAuth registration per local AirApp. */
export const busabaseAirAppCredentialsDir = (options: BusabaseAirAppCredentialStoreOptions = {}) =>
  join(storeRoot(options), "airapps");

export const busabaseAirAppCredentialPath = (
  appId: string,
  options: BusabaseAirAppCredentialStoreOptions = {},
) => join(busabaseAirAppCredentialsDir(options), `${assertAppId(appId)}.json`);

/**
 * Dynamically registered public client ids, keyed by `${baseUrl}|${redirectUri}`.
 *
 * Kept out of the credential file because registration happens before any token exists, and the
 * mapping must outlive both the process and a logout — re-registering on every restart would
 * churn server-side client records and burn the registration rate limit.
 */
export const busabaseAirAppDynamicClientsPath = (
  appId: string,
  options: BusabaseAirAppCredentialStoreOptions = {},
) => join(busabaseAirAppCredentialsDir(options), `${assertAppId(appId)}.clients.json`);

const normalizeOrigin = (raw: string) => {
  const url = new URL(normalizeBaseUrl(raw));
  if (url.username || url.password || url.search || url.hash) {
    throw new BusabaseOAuthError("invalid_base_url", "Busabase base URL must be an origin");
  }
  return url.origin;
};

const writeOwnerOnlyJson = (path: string, value: unknown) => {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
  } catch {
    // Best effort on filesystems without POSIX modes.
  }
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(temporaryPath, 0o600);
  } catch {
    // Best effort on filesystems without POSIX modes.
  }
  renameSync(temporaryPath, path);
};

const parseCredential = (raw: string, expectedAppId: string): BusabaseAirAppOAuthCredential => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new BusabaseOAuthError("invalid_local_credential", "AirApp OAuth credential is invalid");
  }
  const item = value as Partial<BusabaseAirAppOAuthCredential>;
  if (
    item.version !== STORE_VERSION ||
    item.appId !== expectedAppId ||
    typeof item.baseUrl !== "string" ||
    typeof item.clientId !== "string" ||
    typeof item.accessToken !== "string" ||
    typeof item.refreshToken !== "string" ||
    typeof item.expiresAt !== "string" ||
    !Array.isArray(item.scope) ||
    item.scope.some((scope) => typeof scope !== "string") ||
    typeof item.tokenType !== "string"
  ) {
    throw new BusabaseOAuthError("invalid_local_credential", "AirApp OAuth credential is invalid");
  }
  if (
    item.selectedSpace !== undefined &&
    (typeof item.selectedSpace !== "object" ||
      item.selectedSpace === null ||
      typeof item.selectedSpace.id !== "string" ||
      typeof item.selectedSpace.name !== "string")
  ) {
    throw new BusabaseOAuthError("invalid_local_credential", "AirApp OAuth credential is invalid");
  }
  return item as BusabaseAirAppOAuthCredential;
};

export function loadBusabaseAirAppOAuthCredential(
  appId: string,
  options: BusabaseAirAppCredentialStoreOptions = {},
): BusabaseAirAppOAuthCredential | null {
  const path = busabaseAirAppCredentialPath(appId, options);
  try {
    return parseCredential(readFileSync(path, "utf8"), appId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function storeBusabaseAirAppOAuthCredential(
  input: {
    appId: string;
    baseUrl: string;
    tokenSet: BusabaseOAuthTokenSet;
    clientId?: string;
    selectedSpace?: BusabaseAirAppOAuthCredential["selectedSpace"];
  },
  options: BusabaseAirAppCredentialStoreOptions = {},
): BusabaseAirAppOAuthCredential {
  if (!input.tokenSet.refreshToken) {
    throw new BusabaseOAuthError(
      "missing_refresh_token",
      "A refresh token is required for a persistent local AirApp login",
    );
  }
  const credential: BusabaseAirAppOAuthCredential = {
    version: STORE_VERSION,
    appId: assertAppId(input.appId),
    baseUrl: normalizeOrigin(input.baseUrl),
    clientId: input.clientId ?? BUSABASE_AIRAPP_CLIENT_ID,
    accessToken: input.tokenSet.accessToken,
    refreshToken: input.tokenSet.refreshToken,
    expiresAt: input.tokenSet.expiresAt,
    scope: input.tokenSet.scope,
    tokenType: input.tokenSet.tokenType,
    ...(input.selectedSpace ? { selectedSpace: input.selectedSpace } : {}),
  };
  writeOwnerOnlyJson(busabaseAirAppCredentialPath(input.appId, options), credential);
  return credential;
}

interface BusabaseAirAppDynamicClientRegistry {
  version: 1;
  appId: string;
  clients: Record<string, string>;
}

/** Bounded so a long-lived AirApp that moves between preview origins cannot grow without limit. */
const MAX_DYNAMIC_CLIENTS = 32;

const dynamicClientKey = (baseUrl: string, redirectUri: string) =>
  `${normalizeOrigin(baseUrl)}|${new URL(redirectUri).toString()}`;

const loadDynamicClientRegistry = (
  appId: string,
  options: BusabaseAirAppCredentialStoreOptions,
): BusabaseAirAppDynamicClientRegistry => {
  const empty: BusabaseAirAppDynamicClientRegistry = {
    version: STORE_VERSION,
    appId: assertAppId(appId),
    clients: {},
  };
  let raw: string;
  try {
    raw = readFileSync(busabaseAirAppDynamicClientsPath(appId, options), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw error;
  }
  try {
    const value = JSON.parse(raw) as Partial<BusabaseAirAppDynamicClientRegistry>;
    if (
      value.version !== STORE_VERSION ||
      value.appId !== appId ||
      typeof value.clients !== "object" ||
      value.clients === null
    ) {
      return empty;
    }
    const clients = Object.fromEntries(
      Object.entries(value.clients).filter(([, clientId]) => typeof clientId === "string"),
    );
    return { ...empty, clients };
  } catch {
    // A corrupt registry only costs one re-registration; never fail the connect flow over it.
    return empty;
  }
};

/** Reuse a previously registered public client for this exact origin and callback. */
export function loadBusabaseAirAppDynamicClientId(
  input: { appId: string; baseUrl: string; redirectUri: string },
  options: BusabaseAirAppCredentialStoreOptions = {},
): string | null {
  const registry = loadDynamicClientRegistry(input.appId, options);
  return registry.clients[dynamicClientKey(input.baseUrl, input.redirectUri)] ?? null;
}

export function storeBusabaseAirAppDynamicClientId(
  input: { appId: string; baseUrl: string; redirectUri: string; clientId: string },
  options: BusabaseAirAppCredentialStoreOptions = {},
): void {
  const registry = loadDynamicClientRegistry(input.appId, options);
  const key = dynamicClientKey(input.baseUrl, input.redirectUri);
  delete registry.clients[key];
  const entries = [...Object.entries(registry.clients), [key, input.clientId] as const];
  writeOwnerOnlyJson(busabaseAirAppDynamicClientsPath(input.appId, options), {
    ...registry,
    clients: Object.fromEntries(entries.slice(-MAX_DYNAMIC_CLIENTS)),
  });
}

/** Load a valid access token, rotating and persisting the token set when needed. */
export async function getBusabaseAirAppAccessToken(
  appId: string,
  options: BusabaseAirAppCredentialStoreOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<BusabaseAirAppOAuthCredential | null> {
  const credential = loadBusabaseAirAppOAuthCredential(appId, options);
  if (!credential) return null;
  const expiresAt = Date.parse(credential.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + REFRESH_WINDOW_MS) return credential;

  const credentialPath = busabaseAirAppCredentialPath(appId, options);
  const activeRefresh = refreshesByCredentialPath.get(credentialPath);
  if (activeRefresh) return activeRefresh;

  const refresh = (async () => {
    const tokenSet = await refreshBusabaseOAuthToken(
      {
        baseUrl: credential.baseUrl,
        refreshToken: credential.refreshToken,
        clientId: credential.clientId,
      },
      fetchImpl,
    );
    return storeBusabaseAirAppOAuthCredential(
      {
        appId,
        baseUrl: credential.baseUrl,
        clientId: credential.clientId,
        tokenSet: {
          ...tokenSet,
          refreshToken: tokenSet.refreshToken ?? credential.refreshToken,
        },
        selectedSpace: credential.selectedSpace,
      },
      options,
    );
  })();

  refreshesByCredentialPath.set(credentialPath, refresh);
  try {
    return await refresh;
  } finally {
    if (refreshesByCredentialPath.get(credentialPath) === refresh) {
      refreshesByCredentialPath.delete(credentialPath);
    }
  }
}

/** Persist a Space only after the caller has verified membership through `/api/v1/auth`. */
export function storeBusabaseAirAppSelectedSpace(
  appId: string,
  selectedSpace: { id: string; name: string } | null,
  options: BusabaseAirAppCredentialStoreOptions = {},
): BusabaseAirAppOAuthCredential {
  const credential = loadBusabaseAirAppOAuthCredential(appId, options);
  if (!credential) {
    throw new BusabaseOAuthError(
      "missing_local_credential",
      "Connect this local AirApp before selecting a Space",
    );
  }
  const next: BusabaseAirAppOAuthCredential = {
    ...credential,
    ...(selectedSpace ? { selectedSpace } : { selectedSpace: undefined }),
  };
  writeOwnerOnlyJson(busabaseAirAppCredentialPath(appId, options), next);
  return next;
}

export function clearBusabaseAirAppOAuthCredential(
  appId: string,
  options: BusabaseAirAppCredentialStoreOptions = {},
): void {
  rmSync(busabaseAirAppCredentialPath(appId, options), { force: true });
}

export async function revokeBusabaseAirAppOAuthCredential(
  appId: string,
  options: BusabaseAirAppCredentialStoreOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const credential = loadBusabaseAirAppOAuthCredential(appId, options);
  if (!credential) return;
  try {
    await revokeBusabaseOAuthToken(
      {
        baseUrl: credential.baseUrl,
        token: credential.refreshToken,
        clientId: credential.clientId,
      },
      fetchImpl,
    );
  } finally {
    clearBusabaseAirAppOAuthCredential(appId, options);
  }
}
