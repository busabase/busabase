import { os as baseOs, enhanceRouter, implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { getContextSpaceId } from "../../context";
import { assertWorkspacePermission } from "../../logic/node-acl";
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

/**
 * The one gate for the whole agents family.
 *
 * `write`, deliberately, and not the `manage` that
 * `access-control/api-key-level.ts` assigns this family. Those two answer
 * different questions and both are enforced, in different places:
 *
 * - **Credentials** (an API key on `/api/v1`, an embed capability): the ledger's
 *   `manage` already applies, via `resolveRequiredLevel` in `openapi/router.ts`
 *   and `embed-links/runtime-router.ts`. A leaked key still cannot spawn a
 *   process. Nothing here relaxes that.
 * - **People in the dashboard** (`/api/rpc`, this path): never checked the
 *   ledger at all, for any family. `write` is the first floor this path has
 *   had, and it draws the line where a Cloud member's own laptop is: on Cloud
 *   the agent runs on the member's machine, through their own tunnel, under
 *   their own OS account and credentials, and anything it writes back is still
 *   capped to a proposal. A `read` member, an anonymous visitor, and a
 *   downgraded credential are all still refused.
 *
 * Going to `manage` here would have made agents the only family in the product
 * enforcing the ledger against humans — vault and webhooks sit at the same
 * declared tier and remain reachable by any member on this path — while
 * removing the feature from most Cloud users. Levelling all three up is a real
 * question, but it is a security decision about three features, not a side
 * effect of shipping this one.
 *
 * Applied as ONE middleware over the whole sub-router rather than a call at the
 * top of each handler, for the same reason `publicSurfaceGuard` is written that
 * way in `router.ts`: a procedure added later inherits the guard instead of
 * needing someone to remember it. The `@`-mention feature reuses this by adding
 * its procedures to this router, not by copying the check.
 *
 * Not applied to the demo router: `router-demo.ts` is a separate implementation
 * of the same contract, serving a visitor who has no actor and no workspace
 * role at all. Its agent is scripted and touches nothing, so gating it would
 * only mean refusing a fake.
 */
const requireAgentWorkspaceAccess = baseOs.middleware(({ next }) => {
  assertWorkspacePermission("write");
  return next();
});

const agentsRouterImpl = {
  catalog: os.agents.catalog.handler(() => listCatalog()),

  connections: {
    list: os.agents.connections.list.handler(({ input }) => listAgentConnections(input.scope)),
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

/** Exported already-guarded, so there is no unguarded variant to mount by mistake. */
export const agentsRouter = enhanceRouter(agentsRouterImpl, {
  errorMap: {},
  middlewares: [requireAgentWorkspaceAccess],
  dedupeLeadingMiddlewares: false,
});
