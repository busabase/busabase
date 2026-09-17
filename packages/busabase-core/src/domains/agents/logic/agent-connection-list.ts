import type {
  AgentConnectionScope,
  AgentConnectionVO,
} from "busabase-contract/domains/agents/types";
import { getContextActorId } from "../../../context";
import { localBudaConfig } from "./agent-catalog";
import { listAgentSessions } from "./agent-session-manager";
import { normalizeLegacyBudaSessions } from "./agent-session-store";
import { listBudaConnections } from "./buda-connection";

/** Display name for an env-configured Buda agent until a real session or vault row names it. */
const ENV_BUDA_AGENT_NAME = "Buda AI Agent";

/**
 * Every connected agent plus the current actor's retained conversation groups.
 *
 * The two transports are discovered differently, because "connected" means
 * different things for them:
 *
 * - **Buda (remote-websocket)** normally has a saved credential. That row is
 *   the connection, and it outlives every conversation held over it — so it
 *   is listed whether or not any session exists. Retained sessions also keep
 *   a disconnected agent visible as a read-only history entry. The one
 *   exception is `BUDA_API_KEY`/`BUDA_AGENT_ID` env config (`localBudaConfig`,
 *   shared with `agent-catalog.ts`'s own fallback in `resolveLaunch`): that
 *   agent has no vault row to read, so it is synthesized as connected below
 *   rather than left indistinguishable from a disconnected one.
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
export async function listAgentConnections(
  scope: AgentConnectionScope = "mine",
): Promise<AgentConnectionVO[]> {
  const budaConnections = await listBudaConnections(scope);
  await Promise.all(
    budaConnections
      .filter((connection) => connection.legacy && connection.ownedByCurrentUser)
      .map((connection) => normalizeLegacyBudaSessions(connection.slug)),
  );
  const sessions = await listAgentSessions();

  const connections: AgentConnectionVO[] = budaConnections.map((connection) => ({
    slug: connection.slug,
    agentName: connection.agentName,
    transport: "remote-websocket" as const,
    sessionCount: sessions.filter((session) => session.slug === connection.slug).length,
    latest: sessions.find((session) => session.slug === connection.slug) ?? null,
    connected: true,
    ownedByCurrentUser: connection.ownedByCurrentUser,
  }));

  // Same presence check as agent-catalog.ts's `resolveLaunch`/`listCatalog`:
  // both BUDA_API_KEY and BUDA_AGENT_ID must be set, a lone one is treated as
  // absent. A vault row for this exact agent (just added above, if any) always
  // wins — env config only fills the gap when no saved connection exists.
  //
  // Also gated by isCloudHost() (getContextActorId() !== undefined): env config
  // lives on the shared server process, not the caller. A Cloud actor must
  // never see that process-wide config surfaced as "their" connected agent —
  // only OSS/desktop, and a tunnel-forwarded Cloud request running on the
  // user's own machine, ever read it. See agent-catalog.ts's isCloudHost() doc.
  const isCloudHost = getContextActorId() !== undefined;
  const envConfig = isCloudHost ? {} : localBudaConfig();
  const envAgentSlug =
    envConfig.token &&
    envConfig.agentId &&
    !budaConnections.some((connection) => connection.agentId === envConfig.agentId)
      ? "buda"
      : null;

  // Grouped by slug so several conversations with one agent read as one entry,
  // which is what the Agents list already claims to show. `listAgentSessions`
  // returns newest-first, so the first session seen for a slug is its latest.
  const seen = new Set(connections.map((connection) => connection.slug));
  for (const session of sessions) {
    if (seen.has(session.slug)) {
      continue;
    }
    seen.add(session.slug);
    connections.push({
      slug: session.slug,
      agentName: session.agentName,
      transport: session.transport,
      sessionCount: sessions.filter((other) => other.slug === session.slug).length,
      latest: session,
      connected:
        (session.transport === "local-subprocess" &&
          sessions.some(
            (other) => other.slug === session.slug && !["ended", "failed"].includes(other.status),
          )) ||
        session.slug === envAgentSlug,
      ownedByCurrentUser: true,
    });
  }

  // The env-configured agent may have no vault row *and* no session yet (its
  // very first prompt, before any session is persisted) — without this, the
  // loop above has nothing to attach `connected: true` to and the agent is
  // invisible rather than merely unnamed.
  if (envAgentSlug && !seen.has(envAgentSlug)) {
    connections.push({
      slug: envAgentSlug,
      agentName: ENV_BUDA_AGENT_NAME,
      transport: "remote-websocket",
      sessionCount: 0,
      latest: null,
      connected: true,
      ownedByCurrentUser: true,
    });
  }

  return connections.sort((a, b) => a.agentName.localeCompare(b.agentName));
}
