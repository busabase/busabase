import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { getContextSpaceId } from "../../context";
import { listCatalog } from "./logic/agent-catalog";
import { disconnectAgentConnection } from "./logic/agent-connection";
import { listAgentConnections } from "./logic/agent-connection-list";
import {
  cancelAgentSession,
  closeAgentSession,
  createAgentSession,
  listAgentSessions,
  promptAgentSession,
  respondToAgentPermission,
  subscribeAgentSession,
} from "./logic/agent-session-manager";

const os = implement(busabaseContract);

/** Turn a thrown Error into an ORPCError whose message the UI can show verbatim. */
function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new ORPCError("BAD_REQUEST", { message });
}

export const agentsRouter = {
  catalog: os.agents.catalog.handler(() => listCatalog()),

  connections: {
    list: os.agents.connections.list.handler(() => listAgentConnections()),
  },

  disconnect: os.agents.disconnect.handler(async ({ input }) => {
    try {
      return await disconnectAgentConnection(input.slug);
    } catch (error) {
      return fail(error);
    }
  }),

  sessions: {
    list: os.agents.sessions.list.handler(() => listAgentSessions()),

    create: os.agents.sessions.create.handler(async ({ input }) => {
      try {
        return await createAgentSession({ slug: input.slug, spaceId: getContextSpaceId() });
      } catch (error) {
        return fail(error);
      }
    }),

    prompt: os.agents.sessions.prompt.handler(async ({ input }) => {
      try {
        await promptAgentSession(input.sessionId, input.text, input.attachments);
        return { accepted: true, sessionId: input.sessionId };
      } catch (error) {
        return fail(error);
      }
    }),

    cancel: os.agents.sessions.cancel.handler(async ({ input }) => {
      try {
        await cancelAgentSession(input.sessionId);
        return { ok: true };
      } catch (error) {
        return fail(error);
      }
    }),

    close: os.agents.sessions.close.handler(({ input }) => {
      try {
        closeAgentSession(input.sessionId);
        return { ok: true };
      } catch (error) {
        return fail(error);
      }
    }),

    respondToPermission: os.agents.sessions.respondToPermission.handler(({ input }) => {
      try {
        respondToAgentPermission(input.sessionId, input.requestId, input.optionId);
        return { ok: true };
      } catch (error) {
        return fail(error);
      }
    }),

    subscribe: os.agents.sessions.subscribe.handler(async function* ({ input, signal }) {
      try {
        yield* subscribeAgentSession(input.sessionId, input.afterSeq, signal);
      } catch (error) {
        return fail(error);
      }
    }),
  },
};
