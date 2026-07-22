/**
 * In-process Cloud tunnel relay client — the OSS half of the Local ↔ Cloud
 * Tunnel connect handshake (spec §5a, §8). Runs as a background module inside
 * OSS's own Next.js server process — NOT a separate CLI/daemon like
 * `apps/buda-connector` (deliberate scope reduction: OSS is one process
 * already, per the main spec's §4 non-goals).
 *
 * Transport is `relaylib` (`attachRelayClient` + `createFetchHandler`) — the
 * same package `apps/busabase-cloud` already depends on. Reconnect/backoff
 * shape is mirrored from `apps/buda-connector/src/relay.ts` (that module's
 * protocol is hand-rolled and NOT reused; only the backoff strategy is worth
 * copying).
 */
import "server-only";
import { hostname } from "node:os";
import { attachRelayClient, createFetchHandler } from "relaylib";
import WebSocket from "ws";
import { getDb } from "~/db";
import { refreshCloudConnectCredential } from "./cloud-connect-oauth";
import { getCloudConnectRow, saveCloudConnectCredential } from "./cloud-connect-store";

export type CloudTunnelStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface CloudTunnelStatusSnapshot {
  status: CloudTunnelStatus;
  error: string | null;
  cloudUrl: string | null;
  tunnelId: string | null;
}

interface CloudTunnelState {
  status: CloudTunnelStatus;
  error: string | null;
  cloudUrl: string | null;
  tunnelId: string | null;
  credentialToken: string | null;
  credentialRefreshToken: string | null;
  credentialExpiresAt: Date | null;
  ossOrigin: string | null;
  socket: WebSocket | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  reconnectDelayMs: number;
  /** true once `stopCloudTunnel()` is called — suppresses auto-reconnect. */
  stopped: boolean;
}

type GlobalWithTunnelState = typeof globalThis & {
  __busabaseCloudTunnelState?: CloudTunnelState;
};

// Heartbeat well under Cloud's stale threshold (see
// apps/busabase-cloud/src/domains/tunnel/logic/tunnel-registry.ts's
// STALE_AFTER_MS = 30_000 / OFFLINE_AFTER_MS = 120_000) so a healthy tunnel
// never flickers to "stale" between beats.
const HEARTBEAT_INTERVAL_MS = 15_000;
// Reconnect backoff: mirrors apps/buda-connector/src/relay.ts's shape — start
// low, double on failure, cap at 30s, reset on success, ±20% jitter so a
// restart doesn't thunder the server at the exact same instant.
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_JITTER = 0.2;
const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_RETRY_MS = 30 * 1000;

function getState(): CloudTunnelState {
  const g = globalThis as GlobalWithTunnelState;
  if (!g.__busabaseCloudTunnelState) {
    g.__busabaseCloudTunnelState = {
      status: "disconnected",
      error: null,
      cloudUrl: null,
      tunnelId: null,
      credentialToken: null,
      credentialRefreshToken: null,
      credentialExpiresAt: null,
      ossOrigin: null,
      socket: null,
      heartbeatTimer: null,
      reconnectTimer: null,
      refreshTimer: null,
      reconnectDelayMs: RECONNECT_BASE_MS,
      stopped: true,
    };
  }
  return g.__busabaseCloudTunnelState;
}

export function getCloudTunnelStatus(): CloudTunnelStatusSnapshot {
  const state = getState();
  return {
    status: state.status,
    error: state.error,
    cloudUrl: state.cloudUrl,
    tunnelId: state.tunnelId,
  };
}

function clearConnectionTimers(state: CloudTunnelState): void {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

function clearAllTimers(state: CloudTunnelState): void {
  clearConnectionTimers(state);
  if (state.refreshTimer) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function nextReconnectDelay(state: CloudTunnelState): number {
  const base = state.reconnectDelayMs;
  state.reconnectDelayMs = Math.min(state.reconnectDelayMs * 2, RECONNECT_MAX_MS);
  const jitter = base * RECONNECT_JITTER * (Math.random() * 2 - 1);
  return Math.max(500, Math.round(base + jitter));
}

function wsUrlFor(cloudUrl: string, tunnelId: string): string {
  const url = new URL("/api/tunnel/ws", cloudUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("tunnelId", tunnelId);
  return url.toString();
}

async function registerWithCloud(state: CloudTunnelState): Promise<void> {
  const res = await fetch(new URL("/api/tunnel/register", state.cloudUrl as string), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${state.credentialToken}`,
    },
    body: JSON.stringify({
      tunnelId: state.tunnelId,
      deviceName: hostname(),
      hostLabel: hostname(),
      platform: process.platform,
      version: "oss",
      baseUrl: state.ossOrigin,
    }),
  });
  if (!res.ok) throw new Error(`Tunnel register failed (HTTP ${res.status})`);
}

async function heartbeatWithCloud(state: CloudTunnelState): Promise<void> {
  const res = await fetch(new URL("/api/tunnel/heartbeat", state.cloudUrl as string), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${state.credentialToken}`,
    },
    body: JSON.stringify({ tunnelId: state.tunnelId }),
  });
  if (!res.ok) throw new Error(`Tunnel heartbeat failed (HTTP ${res.status})`);
}

async function unregisterFromCloud(state: CloudTunnelState): Promise<void> {
  if (!state.cloudUrl || !state.tunnelId || !state.credentialToken) return;
  try {
    await fetch(new URL("/api/tunnel/unregister", state.cloudUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${state.credentialToken}`,
      },
      body: JSON.stringify({ tunnelId: state.tunnelId }),
    });
  } catch {
    // Best-effort — the socket is already being torn down locally regardless.
  }
}

function scheduleReconnect(state: CloudTunnelState, reason: string): void {
  if (state.stopped || state.reconnectTimer) return;
  const delay = nextReconnectDelay(state);
  console.warn(`[cloud-connect] reconnecting in ${delay}ms (${reason})`);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectSocket(state);
  }, delay);
}

function scheduleCredentialRefresh(state: CloudTunnelState, retryDelayMs?: number): void {
  if (state.stopped || !state.credentialExpiresAt || state.refreshTimer) return;
  const delay =
    retryDelayMs ??
    Math.max(0, state.credentialExpiresAt.getTime() - Date.now() - TOKEN_REFRESH_WINDOW_MS);
  state.refreshTimer = setTimeout(() => {
    state.refreshTimer = null;
    void refreshCredential(state);
  }, delay);
}

async function refreshCredential(state: CloudTunnelState): Promise<void> {
  if (
    state.stopped ||
    !state.cloudUrl ||
    !state.tunnelId ||
    !state.credentialRefreshToken ||
    !state.ossOrigin
  ) {
    return;
  }

  try {
    const credential = await refreshCloudConnectCredential(
      state.cloudUrl,
      state.credentialRefreshToken,
      state.tunnelId,
    );
    if (state.stopped || credential.tunnelId !== state.tunnelId) return;

    state.credentialToken = credential.token;
    state.credentialRefreshToken = credential.refreshToken;
    state.credentialExpiresAt = new Date(credential.expiresAt);

    const db = await getDb();
    await saveCloudConnectCredential(db, {
      token: credential.token,
      refreshToken: credential.refreshToken,
      expiresAt: state.credentialExpiresAt,
      ossOrigin: state.ossOrigin,
    });
    scheduleCredentialRefresh(state);
  } catch (error) {
    console.warn(
      "[cloud-connect] credential refresh failed",
      error instanceof Error ? error.message : error,
    );
    if (!state.stopped) scheduleCredentialRefresh(state, TOKEN_REFRESH_RETRY_MS);
  }
}

function connectSocket(state: CloudTunnelState): void {
  if (state.stopped || !state.cloudUrl || !state.tunnelId || !state.credentialToken) return;

  const socket = new WebSocket(wsUrlFor(state.cloudUrl, state.tunnelId), {
    headers: { authorization: `Bearer ${state.credentialToken}` },
  });
  state.socket = socket;

  socket.on("open", () => {
    if (state.stopped || state.socket !== socket) return;
    state.status = "connected";
    state.error = null;
    state.reconnectDelayMs = RECONNECT_BASE_MS;
    attachRelayClient(socket, createFetchHandler(state.ossOrigin as string));
    state.heartbeatTimer = setInterval(() => {
      heartbeatWithCloud(state).catch((error) => {
        console.warn(
          "[cloud-connect] heartbeat failed",
          error instanceof Error ? error.message : error,
        );
      });
    }, HEARTBEAT_INTERVAL_MS);
  });

  socket.on("close", () => {
    if (state.socket !== socket) return; // stale listener from a superseded socket
    state.socket = null;
    clearConnectionTimers(state);
    if (state.stopped) {
      state.status = "disconnected";
      return;
    }
    state.status = "reconnecting";
    scheduleReconnect(state, "close");
  });

  socket.on("error", (error) => {
    if (state.socket !== socket) return;
    console.warn("[cloud-connect] socket error", error instanceof Error ? error.message : error);
    // 'close' usually follows 'error' — let it drive the reconnect so we don't
    // double-schedule; only force one here if 'close' never arrives.
    if (!state.stopped && state.status !== "reconnecting") {
      state.status = "reconnecting";
      scheduleReconnect(state, "error");
    }
  });
}

export interface StartCloudTunnelInput {
  cloudUrl: string;
  tunnelId: string;
  token: string;
  refreshToken: string;
  expiresAt: Date;
  /** This OSS server's own reachable origin, e.g. `http://localhost:15419` —
   *  where `createFetchHandler` forwards Cloud's relayed requests. */
  ossOrigin: string;
}

/** Register with Cloud, then open the relay socket. Throws if register fails. */
export async function startCloudTunnel(input: StartCloudTunnelInput): Promise<void> {
  const state = getState();
  // A previous live socket (e.g. resumed then Connect clicked again) must not
  // keep running once we redirect its slot to a new one.
  if (state.socket) {
    const stale = state.socket;
    state.socket = null;
    stale.removeAllListeners();
    stale.close();
  }
  clearAllTimers(state);

  state.stopped = false;
  state.cloudUrl = input.cloudUrl;
  state.tunnelId = input.tunnelId;
  state.credentialToken = input.token;
  state.credentialRefreshToken = input.refreshToken;
  state.credentialExpiresAt = input.expiresAt;
  state.ossOrigin = input.ossOrigin;
  state.status = "connecting";
  state.error = null;
  state.reconnectDelayMs = RECONNECT_BASE_MS;

  try {
    await registerWithCloud(state);
  } catch (error) {
    state.status = "error";
    state.error = error instanceof Error ? error.message : String(error);
    throw error;
  }

  connectSocket(state);
  scheduleCredentialRefresh(state);
}

/** Disconnect: stop reconnecting, close the socket, best-effort unregister. */
export async function stopCloudTunnel(): Promise<void> {
  const state = getState();
  state.stopped = true;
  clearAllTimers(state);
  const socket = state.socket;
  state.socket = null;
  if (socket) {
    socket.removeAllListeners();
    socket.close();
  }
  await unregisterFromCloud(state);
  state.status = "disconnected";
  state.error = null;
}

/**
 * Resume the tunnel on server boot, rotating an expired or near-expiry access
 * token first. See `~/instrumentation.node.ts`.
 */
export async function resumeCloudTunnelOnBoot(): Promise<void> {
  try {
    const db = await getDb();
    const row = await getCloudConnectRow(db);
    if (
      !row?.credentialToken ||
      !row.credentialRefreshToken ||
      !row.credentialExpiresAt ||
      !row.ossOrigin
    ) {
      return;
    }

    let token = row.credentialToken;
    let refreshToken = row.credentialRefreshToken;
    let expiresAt = row.credentialExpiresAt;
    if (expiresAt.getTime() <= Date.now() + TOKEN_REFRESH_WINDOW_MS) {
      const credential = await refreshCloudConnectCredential(
        row.cloudUrl,
        refreshToken,
        row.tunnelId,
      );
      token = credential.token;
      refreshToken = credential.refreshToken;
      expiresAt = new Date(credential.expiresAt);
      await saveCloudConnectCredential(db, {
        token,
        refreshToken,
        expiresAt,
        ossOrigin: row.ossOrigin,
      });
    }

    await startCloudTunnel({
      cloudUrl: row.cloudUrl,
      tunnelId: row.tunnelId,
      token,
      refreshToken,
      expiresAt,
      ossOrigin: row.ossOrigin,
    });
    console.log(`[cloud-connect] resumed tunnel to ${row.cloudUrl} on boot`);
  } catch (error) {
    console.warn(
      "[cloud-connect] failed to resume tunnel on boot",
      error instanceof Error ? error.message : error,
    );
  }
}
