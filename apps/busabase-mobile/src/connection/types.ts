export interface BusabaseConnection {
  // "demo" = the preset hosted demo server (one-tap, for App Review and new users);
  // "self-hosted" = a server URL the user entered;
  // "cloud" = authenticated Busabase Cloud session.
  mode: "self-hosted" | "demo" | "cloud";
  serverUrl: string;
  connectedAt: string;
  cloudUser?: {
    id?: string;
    email?: string;
    name?: string;
    image?: string | null;
  };
}

interface ConnectionStateBase {
  recentServerUrl: string | null;
  serverHistory: string[];
}

export type ConnectionState =
  | ({ status: "loading"; connection: null } & ConnectionStateBase)
  | ({ status: "disconnected"; connection: null } & ConnectionStateBase)
  | ({ status: "connected"; connection: BusabaseConnection } & ConnectionStateBase);
