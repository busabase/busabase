import type { AgentConnectionVO, AgentTransport } from "busabase-contract/domains/agents/types";

export type AgentConnectionState =
  | "saved"
  | "disconnected"
  | "activating"
  | "disconnecting"
  | "local"
  | "checking"
  | "unknown";

export const getAgentConnectionState = (connection: AgentConnectionVO): AgentConnectionState => {
  if (connection.transport === "local-subprocess") return "local";
  if (connection.connectionState === "activating") return "activating";
  if (connection.connectionState === "disconnecting") return "disconnecting";
  return connection.connected ? "saved" : "disconnected";
};

/** Saved authorization permits a launch; it is not an agent liveness probe. */
export const getAgentConnectionAvailability = ({
  slug,
  transport,
  connections,
  pending,
  error,
}: {
  slug: string;
  transport?: AgentTransport;
  connections?: readonly AgentConnectionVO[];
  pending: boolean;
  error: boolean;
}): { state: AgentConnectionState; canChat: boolean; transport: AgentTransport } => {
  const connection = connections?.find((item) => item.slug === slug);
  const remote =
    connection?.transport === "remote-websocket" ||
    transport === "remote-websocket" ||
    slug === "buda" ||
    slug.startsWith("buda:") ||
    slug.startsWith("acprouter:");
  if (!remote) return { state: "local", canChat: true, transport: "local-subprocess" };
  const state = error
    ? "unknown"
    : pending || connections === undefined
      ? "checking"
      : connection
        ? getAgentConnectionState(connection)
        : "disconnected";
  return { state, canChat: state === "saved", transport: "remote-websocket" };
};
