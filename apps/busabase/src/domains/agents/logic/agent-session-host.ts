import { LOCAL_SPACE_ID, runWithLocalContext } from "busabase-core/context";
import { getDb } from "busabase-core/db";
import { startAgentSessionSupervisorHost } from "busabase-core/domains/agents/logic/agent-session-supervisor";

/** The local host supports its one local principal, never a captured Cloud scope. */
export async function startLocalAgentSessionHost(): Promise<() => Promise<void>> {
  await import("busabase-core/domains/agents/logic/agent-session-manager");
  return startAgentSessionSupervisorHost({
    database: getDb,
    async runAs(scope, operation) {
      if (scope.actorId !== null || scope.spaceId !== LOCAL_SPACE_ID)
        throw new Error("This local host cannot supervise another principal's session.");
      return runWithLocalContext({}, operation);
    },
  });
}
