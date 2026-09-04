import { enhanceRouter, implement, ORPCError, os } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { getContextSpaceId, isEmbedVisitor, isPublicVisitor, resolveActorId } from "./context";
import { getDb } from "./db";
import { agentsRouter } from "./domains/agents/router";
import { airappRouter } from "./domains/airapp/router";
import { assetsRouter } from "./domains/assets/router";
import {
  confirmNodeIconUpload,
  requestNodeIconUploadUrl,
} from "./domains/attachments/logic/attachments-logic";
import { baseRouter, recordRouter, viewRouter } from "./domains/base/router";
import { docRouter } from "./domains/doc/router";
import { dumpRouter } from "./domains/dump/router";
import { embedLinksRouter } from "./domains/embed-links/router";
import { fileRouter } from "./domains/file-node/router";
import { fileTreeRouter } from "./domains/filetree/router";
import { formRouter } from "./domains/form/router";
import { guidesRouter } from "./domains/guides/router";
import { installRouter } from "./domains/install/router";
import { updateNodeContent } from "./domains/rich-node/handlers";
import { templatesRouter } from "./domains/templates/router";
import { vaultRouter } from "./domains/vault/router";
import { webhookRouter } from "./domains/webhook/router";
import { listActivityPaged } from "./logic/activity";
import {
  anonymousAccessKindFor,
  denyPublicProcedure,
  isEmbedProcedureAllowed,
} from "./logic/anonymous-allowlist";
import { grepUnified } from "./logic/grep";
import { subscribeBusabaseLiveEvents } from "./logic/live-events";
import { listMentionInbox, markMentionsRead } from "./logic/mention-inbox";
import {
  getPublicScopeOfNodeRef,
  grantNodePrincipal,
  listNodePrincipals,
  revokeNodePrincipal,
  updateNodeVisibility,
} from "./logic/node-acl";
import { listNodeActivity, listRecordActivity } from "./logic/node-activity";
import { readNodeLines } from "./logic/node-content";
import { getNodeDetail, listNodeAncestorIds } from "./logic/node-detail";
import { resolveNodeRouteState } from "./logic/node-route-state";
import { disableNodeShare, getNodeShare, setNodeShare } from "./logic/node-share";
import {
  closeChangeRequest,
  countChangeRequests,
  createAuditEvent,
  createComment,
  createNodeChangeRequest,
  getAuthInfo,
  getChangeRequest,
  getInboxSnapshot,
  getNodeAgentPrompts,
  isDescendantOf,
  listAgentTasks,
  listArchivedNodes,
  listAuditEvents,
  listChangeRequestsPage,
  listChangeRequestsPaged,
  listComments,
  listFavoriteNodes,
  listNodeSummaries,
  listNodes,
  mergeChangeRequests,
  moveNode,
  purgeNode,
  reviewChangeRequests,
  reviseOperation,
  searchBusabase,
  searchNodesByName,
  toggleNodeFavorite,
  updateNodeAgentPrompts,
  updateNodeMetadata,
  updateNodeSettings,
} from "./logic/store";

// Kernel oRPC router: kernel routes inline (search / nodes / audit / comments /
// change-request lifecycle / operations); per-domain route slices composed from the domains.
const busabase = implement(busabaseContract);

/**
 * PO → VO for a node's public-share row. SECURITY: strips `passwordHash` down to
 * a boolean `hasPassword` flag — the stored hash must never cross the wire — and
 * serializes the dates. Returns `null` when the node was never shared.
 */
const toNodeShareVO = (
  row: Awaited<ReturnType<typeof getNodeShare>>,
): {
  nodeId: string;
  scope: "none" | "public";
  capability: "read" | "submit";
  hasPassword: boolean;
  expiresAt: string | null;
  updatedAt: string;
} | null =>
  row === null
    ? null
    : {
        nodeId: row.nodeId,
        scope: row.scope,
        capability: row.capability,
        hasPassword: row.passwordHash != null,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        updatedAt: row.updatedAt.toISOString(),
      };

const busabaseRouterImpl = busabase.router({
  auth: {
    verify: busabase.auth.verify.handler(async () => getAuthInfo()),
  },
  search: busabase.search.handler(async ({ input }) => searchBusabase(input)),
  grep: busabase.grep.handler(async ({ input }) => grepUnified(input)),
  embedLinks: embedLinksRouter,
  nodes: {
    list: busabase.nodes.list.handler(async ({ input }) => {
      // `types` opts into the flat summary projection that replaced the four
      // narrow listings. Absent, every existing caller keeps exactly the tree /
      // bounded-tree / archived behaviour it had before this parameter existed.
      if (input?.types && input.types.length > 0) {
        return listNodeSummaries(input.types, input.status ?? "active");
      }
      return input?.status === "archived" ? listArchivedNodes() : listNodes(input);
    }),
    get: busabase.nodes.get.handler(async ({ input }) => getNodeDetail(input.nodeId, input.type)),
    searchByName: busabase.nodes.searchByName.handler(async ({ input }) =>
      searchNodesByName(input),
    ),
    isDescendant: busabase.nodes.isDescendant.handler(async ({ input }) => ({
      isDescendant: await isDescendantOf(
        await getDb(),
        getContextSpaceId(),
        input.nodeId,
        input.potentialAncestorId,
      ),
    })),
    ancestors: busabase.nodes.ancestors.handler(async ({ input }) =>
      listNodeAncestorIds(input.nodeId, input.type),
    ),
    resolveRouteState: busabase.nodes.resolveRouteState.handler(async ({ input }) =>
      resolveNodeRouteState(input.nodeId, input.type),
    ),
    createChangeRequest: busabase.nodes.createChangeRequest.handler(async ({ input }) =>
      createNodeChangeRequest(input),
    ),
    move: busabase.nodes.move.handler(async ({ input }) => moveNode(input)),
    updateMetadata: busabase.nodes.updateMetadata.handler(async ({ input }) =>
      updateNodeMetadata(input),
    ),
    updateSettings: busabase.nodes.updateSettings.handler(async ({ input }) =>
      updateNodeSettings(input),
    ),
    getAgentPrompts: busabase.nodes.getAgentPrompts.handler(async ({ input }) =>
      getNodeAgentPrompts(input),
    ),
    updateAgentPrompts: busabase.nodes.updateAgentPrompts.handler(async ({ input }) =>
      updateNodeAgentPrompts(input),
    ),
    updateContent: busabase.nodes.updateContent.handler(async ({ input }) =>
      updateNodeContent(input),
    ),
    readLines: busabase.nodes.readLines.handler(async ({ input }) =>
      readNodeLines(input.nodeId, input.startLine, input.endLine),
    ),
    purge: busabase.nodes.purge.handler(async ({ input }) => purgeNode(input.nodeId)),
    updateVisibility: busabase.nodes.updateVisibility.handler(async ({ input }) => {
      await updateNodeVisibility(input.nodeId, input.visibility, resolveActorId("local-user"));
      return { updated: true };
    }),
    toggleFavorite: busabase.nodes.toggleFavorite.handler(async ({ input }) =>
      toggleNodeFavorite(input.nodeId, resolveActorId("local-user")),
    ),
    listFavorites: busabase.nodes.listFavorites.handler(async () =>
      listFavoriteNodes(resolveActorId("local-user")),
    ),
    principals: {
      list: busabase.nodes.principals.list.handler(async ({ input }) => {
        const rows = await listNodePrincipals(input.nodeId, resolveActorId("local-user"));
        return rows.map((row) => ({
          id: row.id,
          nodeId: row.nodeId,
          principalType: row.principalType,
          principalId: row.principalId,
          role: row.role,
          grantedBy: row.grantedBy,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }));
      }),
      add: busabase.nodes.principals.add.handler(async ({ input }) => {
        await grantNodePrincipal(
          input.nodeId,
          {
            principalType: input.principalType,
            principalId: input.principalId,
            role: input.role,
          },
          resolveActorId("local-user"),
        );
        return { granted: true };
      }),
      remove: busabase.nodes.principals.remove.handler(async ({ input }) => {
        await revokeNodePrincipal(
          input.nodeId,
          input.principalType,
          input.principalId,
          resolveActorId("local-user"),
        );
        return { removed: true };
      }),
    },
    share: {
      get: busabase.nodes.share.get.handler(async ({ input }) =>
        toNodeShareVO(await getNodeShare(input.nodeId)),
      ),
      set: busabase.nodes.share.set.handler(async ({ input }) =>
        toNodeShareVO(
          await setNodeShare(input.nodeId, {
            scope: input.scope,
            capability: input.capability,
            password: input.password,
            expiresAt:
              input.expiresAt === undefined
                ? undefined
                : input.expiresAt === null
                  ? null
                  : new Date(input.expiresAt),
          }),
        ),
      ),
      disable: busabase.nodes.share.disable.handler(async ({ input }) =>
        toNodeShareVO(await disableNodeShare(input.nodeId)),
      ),
    },
    icon: {
      createUploadUrl: busabase.nodes.icon.createUploadUrl.handler(async ({ input }) =>
        requestNodeIconUploadUrl(await getDb(), input),
      ),
      confirm: busabase.nodes.icon.confirm.handler(async ({ input }) =>
        confirmNodeIconUpload(await getDb(), input),
      ),
    },
  },
  auditEvents: {
    list: busabase.auditEvents.list.handler(async ({ input }) => listAuditEvents(input)),
    create: busabase.auditEvents.create.handler(async ({ input }) => createAuditEvent(input)),
  },
  activity: {
    listPaged: busabase.activity.listPaged.handler(async ({ input }) => listActivityPaged(input)),
    listForNode: busabase.activity.listForNode.handler(async ({ input }) =>
      listNodeActivity(input.nodeId, { limit: input.limit }),
    ),
    listForRecord: busabase.activity.listForRecord.handler(async ({ input }) =>
      listRecordActivity(input.recordId, { limit: input.limit }),
    ),
  },
  comments: {
    list: busabase.comments.list.handler(async ({ input }) => listComments(input)),
    create: busabase.comments.create.handler(async ({ input }) => createComment(input)),
    listMentions: busabase.comments.listMentions.handler(async ({ input }) =>
      listMentionInbox(await getDb(), input),
    ),
    markMentionsRead: busabase.comments.markMentionsRead.handler(async ({ input }) =>
      markMentionsRead(await getDb(), input),
    ),
  },
  agent: {
    listTasks: busabase.agent.listTasks.handler(async () => listAgentTasks()),
  },
  live: {
    subscribe: busabase.live.subscribe.handler(({ signal }) =>
      subscribeBusabaseLiveEvents(getContextSpaceId(), signal),
    ),
  },
  bases: baseRouter,
  fileTrees: fileTreeRouter,
  airapps: airappRouter,
  files: fileRouter,
  docs: docRouter,
  forms: formRouter,
  assets: assetsRouter,
  guides: guidesRouter,
  vault: vaultRouter,
  agents: agentsRouter,
  webhooks: webhookRouter,
  dump: dumpRouter,
  install: installRouter,
  templates: templatesRouter,
  changeRequests: {
    list: busabase.changeRequests.list.handler(async ({ input }) => listChangeRequestsPaged(input)),
    listPage: busabase.changeRequests.listPage.handler(async ({ input }) =>
      listChangeRequestsPage(input),
    ),
    inboxSnapshot: busabase.changeRequests.inboxSnapshot.handler(async ({ input }) =>
      getInboxSnapshot(input),
    ),
    counts: busabase.changeRequests.counts.handler(async () => countChangeRequests()),
    get: busabase.changeRequests.get.handler(async ({ input }) => {
      const changeRequest = await getChangeRequest(input.changeRequestId);
      if (!changeRequest) {
        throw new ORPCError("NOT_FOUND", {
          message: `Change request not found: ${input.changeRequestId}`,
        });
      }
      return changeRequest;
    }),
    review: busabase.changeRequests.review.handler(async ({ input }) => {
      const { changeRequestIds, ...rest } = input;
      return reviewChangeRequests(changeRequestIds, rest);
    }),
    close: busabase.changeRequests.close.handler(async ({ input }) =>
      closeChangeRequest(input.changeRequestId, input.reason),
    ),
    merge: busabase.changeRequests.merge.handler(async ({ input }) =>
      mergeChangeRequests(input.changeRequestIds),
    ),
  },
  operations: {
    revise: busabase.operations.revise.handler(async ({ input }) => {
      const { operationId, ...rest } = input;
      return reviseOperation(operationId, rest);
    }),
  },
  records: recordRouter,
  views: viewRouter,
});

/** Best-effort `nodeId` read off a not-yet-validated middleware input. */
const readNodeId = (input: unknown): string | null => {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as { nodeId?: unknown }).nodeId;
  return typeof value === "string" && value.length > 0 ? value : null;
};

/**
 * Per-procedure default-deny gate for LINK-authorized visitors — both the
 * guest arriving through a public node share and the holder of an Embed Link.
 *
 * It is attached to EVERY procedure rather than checked once at the HTTP
 * boundary because the oRPC batch endpoint (`/api/rpc/__batch__`) collapses
 * many procedure calls into one request path — a path-based check there would
 * be bypassed by simply batching the call. Middleware is the only layer every
 * individual call provably passes through.
 *
 * It is a strict no-op for member requests (`isPublicVisitor()` is false), so
 * member-facing behaviour is unchanged; both public branches can only ever
 * remove access, never grant it.
 */
const publicSurfaceGuard = os.middleware(async ({ next, path }, input) => {
  // Members (and the open-source single-user host, which sets no visitorKind)
  // keep exactly the behaviour they had before this gate existed.
  if (!isPublicVisitor()) {
    return next();
  }

  // An Embed Link holder is not a guest: it reads through the link creator's
  // own grants, so it gets its own positive list rather than the share-scoped
  // one. Same default-deny shape, same reason — most of this router is
  // space-scoped with no node ACL behind it.
  if (isEmbedVisitor()) {
    if (!isEmbedProcedureAllowed(path)) {
      denyPublicProcedure(path);
    }
    return next();
  }

  const kind = anonymousAccessKindFor(path);
  // Default-deny: anything not on the explicit public surface — including any
  // procedure added to the router after this file was last touched — fails
  // closed rather than inheriting anonymous access by accident.
  if (kind === null) {
    denyPublicProcedure(path);
  }

  if (kind === "submit") {
    // A `submit` procedure must be authorized against the TARGET NODE's own
    // capability, not merely against "the visitor got in somehow": a node
    // shared read-only must never accept writes. No resolvable node ref means
    // we cannot prove the capability, so we refuse. The ref may be an id or a
    // node slug (a public link carries the slug), and slug resolution is
    // approximate by nature — the handler re-checks the capability on the node
    // it actually resolved. See `getPublicScopeOfNodeRef`.
    const nodeRef = readNodeId(input);
    if (!nodeRef || (await getPublicScopeOfNodeRef(nodeRef, "form")) !== "submit") {
      denyPublicProcedure(path);
    }
  }

  return next();
});

/**
 * The Busabase RPC surface, with the anonymous default-deny gate applied to
 * every procedure (including the composed per-domain sub-routers).
 *
 * Exported already-guarded on purpose: there is no unguarded variant a host
 * could mount by mistake.
 */
export const busabaseRouter = enhanceRouter(busabaseRouterImpl, {
  errorMap: {},
  middlewares: [publicSurfaceGuard],
  dedupeLeadingMiddlewares: false,
});
