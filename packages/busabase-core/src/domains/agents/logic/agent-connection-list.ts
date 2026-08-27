import type { AgentConnectionVO } from "busabase-contract/domains/agents/types";
import { listAgentSessions } from "./agent-session-manager";
import { listBudaConnections } from "./buda-connection";

/**
 * Every agent this workspace can currently talk to.
 *
 * The two transports are discovered differently, because "connected" means
 * different things for them:
 *
 * - **Buda (remote-websocket)** has a saved credential. That row is the
 *   connection, and it outlives every conversation held over it — so it is
 *   listed whether or not any session exists, and sessions are deliberately
 *   *not* used to discover it. Deriving it from sessions would make a
 *   connected agent vanish the moment its history was cleared.
 * - **Local agents (local-subprocess)** have no stored artifact at all.
 *   Connecting one *is* `sessions.create` (see `AgentsAddView`), which spawns
 *   the CLI over ACP. A session is therefore the only evidence one was ever
 *   connected, and reading them is the only way to find it again.
 *
 * That asymmetry is why this cannot be one rule. Until local agents were
 * un-gated there could never be a connected local agent, so listing only Buda
 * rows was indistinguishable from listing everything — un-gating them is what
 * made the difference observable: you could connect Codex, chat with it, and
 * then not find it in the very list that is supposed to show your agents.
 */
export async function listAgentConnections(): Promise<AgentConnectionVO[]> {
  const [budaConnections, sessions] = await Promise.all([
    listBudaConnections(),
    listAgentSessions(),
  ]);

  const connections: AgentConnectionVO[] = budaConnections.map((connection) => ({
    slug: connection.slug,
    agentName: connection.agentName,
    transport: "remote-websocket" as const,
    sessionCount: 0,
    latest: null,
  }));

  // Grouped by slug so several conversations with one agent read as one entry,
  // which is what the Agents list already claims to show. `listAgentSessions`
  // returns newest-first, so the first session seen for a slug is its latest.
  const seen = new Set(connections.map((connection) => connection.slug));
  for (const session of sessions) {
    if (session.transport !== "local-subprocess" || seen.has(session.slug)) {
      continue;
    }
    seen.add(session.slug);
    connections.push({
      slug: session.slug,
      agentName: session.agentName,
      transport: "local-subprocess",
      sessionCount: sessions.filter((other) => other.slug === session.slug).length,
      latest: session,
    });
  }

  return connections.sort((a, b) => a.agentName.localeCompare(b.agentName));
}
