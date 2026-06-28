export interface BusabaseConnection {
  // "demo" = the preset hosted demo server (one-tap, for App Review and new users);
  // "self-hosted" = a server URL the user entered.
  mode: "self-hosted" | "demo";
  serverUrl: string;
  connectedAt: string;
}

interface ConnectionStateBase {
  recentServerUrl: string | null;
  serverHistory: string[];
}

export type ConnectionState =
  | ({ status: "loading"; connection: null } & ConnectionStateBase)
  | ({ status: "disconnected"; connection: null } & ConnectionStateBase)
  | ({ status: "connected"; connection: BusabaseConnection } & ConnectionStateBase);
