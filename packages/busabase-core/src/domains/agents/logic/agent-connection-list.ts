import type { AgentConnectionVO } from "busabase-contract/domains/agents/types";
import { listBudaConnections } from "./buda-connection";

/**
 * List connected Buda agents from their saved connection rows. Sessions are
 * conversation history and are intentionally not used to discover connections.
 */
export async function listAgentConnections(): Promise<AgentConnectionVO[]> {
  const connections = await listBudaConnections();
  return connections
    .map((connection) => ({
      slug: connection.slug,
      agentName: connection.agentName,
      transport: "remote-websocket" as const,
      sessionCount: 0,
      latest: null,
    }))
    .sort((a, b) => a.agentName.localeCompare(b.agentName));
}
