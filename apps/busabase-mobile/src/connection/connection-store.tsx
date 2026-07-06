import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";
import { revokeBusabaseCloudSession } from "~/auth/oauth";
import {
  type CloudSession,
  clearCloudSession,
  getCloudSession,
  getCloudSessionToken,
} from "~/auth/session-store";
import { busabaseConfig } from "./config";
import { normalizeServerUrl } from "./server-url";
import type { BusabaseConnection, BusabaseSpace, ConnectionState } from "./types";

const STORAGE_KEY = "busabase-mobile.connection.v1";
const RECENT_SERVER_KEY = "busabase-mobile.recent-server-url.v1";
const SERVER_HISTORY_KEY = "busabase-mobile.server-history.v1";
const MAX_HISTORY = 5;

// Preset hosted demo server (app.json → expo.extra.busabase.demoServerUrl). Enables a
// one-tap "Try the demo" so App Review and new users can use the app without
// self-hosting. null when not configured (the demo entry is then hidden).
const DEMO_SERVER_URL = busabaseConfig.demoServerUrl;
const CLOUD_SERVER_URL = busabaseConfig.cloudUrl;

interface NativeCookieManager {
  clearAll: () => Promise<boolean>;
}

async function clearBrowserSessionCookies(): Promise<void> {
  if (Platform.OS === "web") return;
  const cookieManager = await import("@react-native-cookies/cookies")
    .then((mod) => mod.default as NativeCookieManager)
    .catch(() => null);
  await cookieManager?.clearAll().catch(() => false);
}

interface ConnectionContextValue {
  state: ConnectionState;
  connectSelfHosted: (serverUrl: string) => Promise<void>;
  connectCloud: (session: CloudSession) => Promise<void>;
  /** One-tap connect to the preset hosted demo server. */
  connectDemo: () => Promise<void>;
  /** Preset demo server URL, or null when not configured. */
  demoServerUrl: string | null;
  cloudServerUrl: string;
  getCloudAuthorizationHeaders: (options?: {
    spaceId?: string | null;
  }) => Promise<Record<string, string>>;
  selectSpace: (space: BusabaseSpace | null) => Promise<void>;
  disconnect: () => Promise<void>;
  removeServerFromHistory: (serverUrl: string) => Promise<void>;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

function parseHistory(raw: string | null): string[] {
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectionState>({
    status: "loading",
    connection: null,
    recentServerUrl: null,
    serverHistory: [],
  });

  useEffect(() => {
    void Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(RECENT_SERVER_KEY),
      AsyncStorage.getItem(SERVER_HISTORY_KEY),
      getCloudSession(),
    ])
      .then(([raw, recentServerUrl, historyRaw, cloudSession]) => {
        const serverHistory = parseHistory(historyRaw);
        if (!raw) {
          setState({ status: "disconnected", connection: null, recentServerUrl, serverHistory });
          return;
        }
        const connection = JSON.parse(raw) as BusabaseConnection;
        if (connection.mode === "cloud" && !getCloudSessionToken(cloudSession)) {
          void AsyncStorage.removeItem(STORAGE_KEY);
          setState({ status: "disconnected", connection: null, recentServerUrl, serverHistory });
          return;
        }
        setState({
          status: "connected",
          connection,
          recentServerUrl: recentServerUrl ?? connection.serverUrl,
          serverHistory,
        });
      })
      .catch(() =>
        setState({
          status: "disconnected",
          connection: null,
          recentServerUrl: null,
          serverHistory: [],
        }),
      );
  }, []);

  const connectWithMode = useCallback(async (input: string, mode: BusabaseConnection["mode"]) => {
    const serverUrl = normalizeServerUrl(input);
    const connection: BusabaseConnection = {
      mode,
      serverUrl,
      connectedAt: new Date().toISOString(),
    };
    let nextHistory: string[] = [];
    setState((current) => {
      // Don't pollute the self-hosted history list with the demo server.
      nextHistory =
        mode === "demo"
          ? current.serverHistory
          : [serverUrl, ...current.serverHistory.filter((url) => url !== serverUrl)].slice(
              0,
              MAX_HISTORY,
            );
      return {
        status: "connected",
        connection,
        recentServerUrl: serverUrl,
        serverHistory: nextHistory,
      };
    });
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(connection)),
      AsyncStorage.setItem(RECENT_SERVER_KEY, serverUrl),
      AsyncStorage.setItem(SERVER_HISTORY_KEY, JSON.stringify(nextHistory)),
    ]);
  }, []);

  const connectSelfHosted = useCallback(
    (input: string) => connectWithMode(input, "self-hosted"),
    [connectWithMode],
  );

  const connectDemo = useCallback(async () => {
    if (!DEMO_SERVER_URL) {
      throw new Error("No demo server is configured");
    }
    await connectWithMode(DEMO_SERVER_URL, "demo");
  }, [connectWithMode]);

  const connectCloud = useCallback(async (session: CloudSession) => {
    const serverUrl = normalizeServerUrl(CLOUD_SERVER_URL);
    const connection: BusabaseConnection = {
      mode: "cloud",
      serverUrl,
      connectedAt: new Date().toISOString(),
      cloudUser: session.user,
    };
    setState((current) => ({
      status: "connected",
      connection,
      recentServerUrl: current.recentServerUrl,
      serverHistory: current.serverHistory,
    }));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
  }, []);

  const getCloudAuthorizationHeaders = useCallback(
    async (options?: { spaceId?: string | null }): Promise<Record<string, string>> => {
      const session = await getCloudSession();
      const token = getCloudSessionToken(session);
      if (!token) return {};
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
        "x-busabase-client": "native",
        "x-busabase-client-platform": "mobile",
      };
      const selectedSpace =
        options && "spaceId" in options
          ? options.spaceId
          : state.status === "connected"
            ? state.connection.selectedSpace?.id
            : undefined;
      if (selectedSpace) {
        headers["x-busabase-space"] = selectedSpace;
      }
      return headers;
    },
    [state],
  );

  const selectSpace = useCallback(async (space: BusabaseSpace | null) => {
    let nextConnection: BusabaseConnection | null = null;
    setState((current) => {
      if (current.status !== "connected") return current;
      nextConnection = {
        ...current.connection,
        selectedSpace: space,
      };
      return {
        ...current,
        connection: nextConnection,
      };
    });
    if (nextConnection) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextConnection));
    }
  }, []);

  const disconnect = useCallback(async () => {
    const cloudConnection = state.status === "connected" && state.connection.mode === "cloud";
    if (cloudConnection) {
      const session = await getCloudSession();
      await revokeBusabaseCloudSession(session);
      await clearCloudSession();
      await clearBrowserSessionCookies();
    }
    await AsyncStorage.removeItem(STORAGE_KEY);
    setState((current) => ({
      status: "disconnected",
      connection: null,
      recentServerUrl:
        current.status === "connected" && current.connection.mode !== "cloud"
          ? current.connection.serverUrl
          : current.recentServerUrl,
      serverHistory: current.serverHistory,
    }));
  }, [state]);

  const removeServerFromHistory = useCallback(async (serverUrl: string) => {
    let nextHistory: string[] = [];
    setState((current) => {
      nextHistory = current.serverHistory.filter((url) => url !== serverUrl);
      return { ...current, serverHistory: nextHistory };
    });
    await AsyncStorage.setItem(SERVER_HISTORY_KEY, JSON.stringify(nextHistory));
  }, []);

  const value = useMemo(
    () => ({
      state,
      connectSelfHosted,
      connectCloud,
      connectDemo,
      demoServerUrl: DEMO_SERVER_URL,
      cloudServerUrl: CLOUD_SERVER_URL,
      getCloudAuthorizationHeaders,
      selectSpace,
      disconnect,
      removeServerFromHistory,
    }),
    [
      state,
      connectSelfHosted,
      connectCloud,
      connectDemo,
      getCloudAuthorizationHeaders,
      selectSpace,
      disconnect,
      removeServerFromHistory,
    ],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection() {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error("useConnection must be used inside ConnectionProvider");
  }
  return context;
}
