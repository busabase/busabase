import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import {
  applyViewConfigToRecords,
  DATE_RANGE_FIELD_TYPES,
  GROUPABLE_FIELD_TYPES,
  groupKeyForValue,
} from "./domains/base/utils/view-records";
import { guidesRouter } from "./domains/guides/router";
import { listTemplates } from "./domains/templates/logic/catalog";
import { buildActivityItemsFromVOs } from "./logic/activity";
import {
  demoCloseChangeRequest,
  demoCreateAuditEvent,
  demoCreateChangeRequest,
  demoCreateComment,
  demoCreateDeleteChangeRequest,
  demoCreateUpdateChangeRequest,
  demoGetAsset,
  demoGetAuthInfo,
  demoGetBase,
  demoGetChangeRequest,
  demoGetFileTree,
  demoGetForm,
  demoGetNodeDetail,
  demoGetRecord,
  demoGetRecordByField,
  demoIsDescendant,
  demoListAgentTasks,
  demoListAssets,
  demoListAuditEvents,
  demoListBases,
  demoListChangeRequests,
  demoListComments,
  demoListNodeSummaries,
  demoListNodes,
  demoListRecordChangeRequests,
  demoListRecords,
  demoListRecordsByFieldText,
  demoListViews,
  demoMergeChangeRequest,
  demoNodeAncestorIds,
  demoReadFileTreeFile,
  demoReadNodeLines,
  demoReviewChangeRequest,
  demoReviseOperation,
  demoSearch,
  demoSearchNodesByName,
  demoSubmitForm,
} from "./logic/demo-store";

// Stateless demo router: the request boundary swaps to this
// when `?demo` is present. It implements the SAME `busabaseContract` as the real
// `busabaseRouter`, but every handler reads the shared seed (`demo/dataset.ts`)
// and writes are synthetic + non-persistent. It never touches the db.
const os = implement(busabaseContract);

const demoUnsupported = (action: string) =>
  new ORPCError("FORBIDDEN", {
    message: `"${action}" is disabled in the Busabase demo. Run Busabase locally to make persistent changes.`,
  });

const demoBatchFailure = (changeRequestId: string, error: unknown) => ({
  changeRequestId,
  ok: false as const,
  error: error instanceof Error ? error.message : String(error),
  ...(error instanceof ORPCError
    ? { code: error.code, ...(error.data === undefined ? {} : { data: error.data }) }
    : {}),
});

/** Keeps the demo's refusal messages verb-specific now that the Base lifecycle,
 *  field, and view change-request verbs share one handler each. */
const operationLabel = (operation: string) =>
  operation.charAt(0).toUpperCase() + operation.slice(1);

/** Keeps the demo's refusal messages type-specific now that Skills, Drives, and
 *  AirApps share one set of handlers. */
const fileTreeLabel = (type: "skill" | "drive" | "airapp" | undefined) =>
  type === "drive" ? "Drive" : type === "airapp" ? "AirApp" : "Skill";

async function* subscribeDemoLiveEvents(signal?: AbortSignal) {
  while (!signal?.aborted) {
    await new Promise<void>((resolve) => {
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }
}

const shouldEmitDemoLiveEvent = () => false;
const DEMO_ACTIVITY_CURSOR_PREFIX = "demo-activity:";
const DEMO_RECORD_CURSOR_PREFIX = "demo-record:";

const demoChangeRequestAffectsNode = (
  changeRequest: ReturnType<typeof demoListChangeRequests>[number],
  nodeId?: string,
) =>
  !nodeId ||
  changeRequest.nodeId === nodeId ||
  changeRequest.base?.nodeId === nodeId ||
  changeRequest.operations.some(
    (operation) =>
      operation.nodeId === nodeId ||
      (operation.operation === "node_create" &&
        operation.headCommit.payload.parentNodeId === nodeId),
  );

const getDemoActivityOffset = (cursor?: string) => {
  if (!cursor?.startsWith(DEMO_ACTIVITY_CURSOR_PREFIX)) return 0;
  const offset = Number.parseInt(cursor.slice(DEMO_ACTIVITY_CURSOR_PREFIX.length), 10);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
};

const getDemoRecordOffset = (cursor?: string) => {
  if (!cursor) return 0;
  const prefix = cursor.startsWith(DEMO_RECORD_CURSOR_PREFIX)
    ? DEMO_RECORD_CURSOR_PREFIX
    : cursor.startsWith("legacy:")
      ? "legacy:"
      : null;
  if (!prefix) return 0;
  const offset = Number.parseInt(cursor.slice(prefix.length), 10);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
};

export const busabaseDemoRouter = os.router({
  auth: {
    verify: os.auth.verify.handler(() => demoGetAuthInfo()),
  },
  search: os.search.handler(({ input }) => demoSearch(input)),
  // Unified Grep needs real per-source storage (Drive text slots + Doc bodies)
  // the stateless in-memory demo dataset doesn't have.
  grep: os.grep.handler(() => {
    throw demoUnsupported("Unified grep");
  }),
  embedLinks: {
    create: os.embedLinks.create.handler(() => {
      throw demoUnsupported("Create embed link");
    }),
    list: os.embedLinks.list.handler(() => []),
    revoke: os.embedLinks.revoke.handler(() => {
      throw demoUnsupported("Revoke embed link");
    }),
  },
  nodes: {
    // Demo mode ignores `parentId`/`depth` — the seeded tree is always fully
    // in memory already, so there's nothing to lazily bound (see
    // `demoListNodes`'s doc comment in logic/demo-store.ts).
    list: os.nodes.list.handler(({ input }) => {
      // `types` gets the same flat summary projection the real store serves —
      // the demo dataset must not be the one place where the consolidated API
      // behaves differently.
      if (input?.types && input.types.length > 0) {
        return input.status === "archived" ? [] : demoListNodeSummaries(input.types);
      }
      return input?.status === "archived" ? [] : demoListNodes();
    }),
    get: os.nodes.get.handler(({ input }) => demoGetNodeDetail(input.nodeId, input.type)),
    searchByName: os.nodes.searchByName.handler(({ input }) => demoSearchNodesByName(input)),
    isDescendant: os.nodes.isDescendant.handler(({ input }) => ({
      isDescendant: demoIsDescendant(input.nodeId, input.potentialAncestorId),
    })),
    ancestors: os.nodes.ancestors.handler(({ input }) => demoNodeAncestorIds(input.nodeId)),
    createChangeRequest: os.nodes.createChangeRequest.handler(() => {
      throw demoUnsupported("Node tree change request");
    }),
    move: os.nodes.move.handler(() => {
      throw demoUnsupported("Move node");
    }),
    updateMetadata: os.nodes.updateMetadata.handler(() => {
      throw demoUnsupported("Update node metadata");
    }),
    updateSettings: os.nodes.updateSettings.handler(() => {
      throw demoUnsupported("Update node settings");
    }),
    // Readable in demo mode, unlike its write sibling: the dialog calls this on
    // every open, and a throw here would turn "this node has no custom prompts"
    // into an error toast on a workspace that is meant to be browsable.
    getAgentPrompts: os.nodes.getAgentPrompts.handler(({ input }) => ({
      nodeId: input.nodeId,
      agentPrompts: null,
    })),
    updateAgentPrompts: os.nodes.updateAgentPrompts.handler(() => {
      throw demoUnsupported("Update node agent prompts");
    }),
    updateContent: os.nodes.updateContent.handler(() => {
      throw demoUnsupported("Update node content");
    }),
    readLines: os.nodes.readLines.handler(({ input }) =>
      demoReadNodeLines(input.nodeId, input.startLine, input.endLine),
    ),
    purge: os.nodes.purge.handler(() => {
      throw demoUnsupported("Permanently delete node");
    }),
    updateVisibility: os.nodes.updateVisibility.handler(() => {
      throw demoUnsupported("Node visibility");
    }),
    toggleFavorite: os.nodes.toggleFavorite.handler(() => {
      throw demoUnsupported("Toggle favorite");
    }),
    // Demo mode has no persisted state to favorite against — an empty list is
    // truthful (matches `listArchived`'s demo handler above), not an error.
    listFavorites: os.nodes.listFavorites.handler(() => []),
    principals: {
      // The demo dataset has no grants — an empty list is truthful, and it
      // lets the Permissions dialog render read-only in demo mode.
      list: os.nodes.principals.list.handler(() => []),
      add: os.nodes.principals.add.handler(() => {
        throw demoUnsupported("Node permissions");
      }),
      remove: os.nodes.principals.remove.handler(() => {
        throw demoUnsupported("Node permissions");
      }),
    },
    share: {
      // The demo dataset is stateless — nothing is ever shared, and there is no
      // db to persist a share against. `get` returns null (truthful: unshared);
      // the mutations are refused just like the other demo writes above.
      get: os.nodes.share.get.handler(() => null),
      set: os.nodes.share.set.handler(() => {
        throw demoUnsupported("Node sharing");
      }),
      disable: os.nodes.share.disable.handler(() => {
        throw demoUnsupported("Node sharing");
      }),
    },
    icon: {
      // The demo dataset is stateless — no db to write an attachment
      // registry row against, so uploads are refused like the other demo
      // writes above.
      createUploadUrl: os.nodes.icon.createUploadUrl.handler(() => {
        throw demoUnsupported("Node icon upload");
      }),
      confirm: os.nodes.icon.confirm.handler(() => {
        throw demoUnsupported("Node icon upload");
      }),
    },
  },
  auditEvents: {
    list: os.auditEvents.list.handler(() => demoListAuditEvents()),
    create: os.auditEvents.create.handler(({ input }) => demoCreateAuditEvent(input)),
  },
  activity: {
    listPaged: os.activity.listPaged.handler(async ({ input }) => {
      const [changeRequests, records, auditEvents] = await Promise.all([
        demoListChangeRequests(),
        demoListRecords(),
        demoListAuditEvents(),
      ]);
      const all = buildActivityItemsFromVOs(changeRequests, records, auditEvents);
      const limit = input?.limit ?? 50;
      const offset = getDemoActivityOffset(input?.cursor);
      const items = all.slice(offset, offset + limit);
      const nextOffset = offset + items.length;
      return {
        items,
        nextCursor: nextOffset < all.length ? `${DEMO_ACTIVITY_CURSOR_PREFIX}${nextOffset}` : null,
      };
    }),
    // Raw, unpaginated per-node stream — same demo dataset, filtered to items
    // whose owning change request (direct or via `operation`'s CR) or audit
    // event targets this node's Base, mirroring the real `listNodeActivity`.
    listForNode: os.activity.listForNode.handler(async ({ input }) => {
      const [changeRequests, records, auditEvents] = await Promise.all([
        demoListChangeRequests(),
        demoListRecords(),
        demoListAuditEvents(),
      ]);
      const base = demoListBases().find((candidate) => candidate.nodeId === input.nodeId);
      const all = buildActivityItemsFromVOs(changeRequests, records, auditEvents).filter((item) => {
        if (item.kind === "change_request" || item.kind === "operation") {
          return item.changeRequest.nodeId === input.nodeId;
        }
        if (item.kind === "audit") {
          return Boolean(base) && item.auditEvent.baseId === base?.id;
        }
        return false;
      });
      return all.slice(0, input.limit ?? 50);
    }),
    // Record-scoped mirror of `listForNode` above, using the same demo
    // dataset — filtered to operations whose target/source/merged record is
    // this recordId, or audit events whose own `recordId` matches.
    listForRecord: os.activity.listForRecord.handler(async ({ input }) => {
      const [changeRequests, records, auditEvents] = await Promise.all([
        demoListChangeRequests(),
        demoListRecords(),
        demoListAuditEvents(),
      ]);
      const all = buildActivityItemsFromVOs(changeRequests, records, auditEvents).filter((item) => {
        if (item.kind === "operation") {
          const operation = item.changeRequest.operations.find((op) => op.id === item.operationId);
          return (
            operation?.targetRecordId === input.recordId ||
            operation?.sourceRecordId === input.recordId ||
            operation?.mergedRecordId === input.recordId
          );
        }
        if (item.kind === "audit") {
          return item.auditEvent.recordId === input.recordId;
        }
        return false;
      });
      return all.slice(0, input.limit ?? 50);
    }),
  },
  comments: {
    list: os.comments.list.handler(({ input }) => demoListComments(input)),
    create: os.comments.create.handler(({ input }) => demoCreateComment(input)),
  },
  agent: {
    listTasks: os.agent.listTasks.handler(() => demoListAgentTasks()),
  },
  live: {
    subscribe: os.live.subscribe.handler(async function* ({ signal }) {
      if (shouldEmitDemoLiveEvent()) {
        yield undefined as never;
      }
      yield* subscribeDemoLiveEvents(signal);
    }),
  },
  bases: {
    list: os.bases.list.handler(({ input }) =>
      input.status === "archived" ? [] : demoListBases(),
    ),
    get: os.bases.get.handler(({ input }) => {
      const base = demoListBases().find(
        (candidate) => candidate.id === input.baseId || candidate.slug === input.baseId,
      );
      if (!base) {
        throw new ORPCError("NOT_FOUND", { message: `Base not found: ${input.baseId}` });
      }
      return base;
    }),
    create: os.bases.create.handler(() => {
      throw demoUnsupported("Create Base");
    }),
    createChangeRequest: os.bases.createChangeRequest.handler(({ input }) => {
      const { baseId, ...rest } = input;
      // Demo mode doesn't implement a real merge engine, so `autoMerge` is a
      // no-op here — every demo record create stays review-first (matches how
      // `bases.create`'s demo handler above never reaches the materialized
      // branch either).
      return { ...demoCreateChangeRequest(baseId, rest), materialized: false as const };
    }),
    createBulkChangeRequest: os.bases.createBulkChangeRequest.handler(() => {
      throw demoUnsupported("Bulk record change request");
    }),
    createBulkUpdateChangeRequest: os.bases.createBulkUpdateChangeRequest.handler(() => {
      throw demoUnsupported("Bulk record update change request");
    }),
    createField: os.bases.createField.handler(() => {
      throw demoUnsupported("Create Base field");
    }),
    listViews: os.bases.listViews.handler(({ input }) =>
      input.status === "archived" ? [] : demoListViews(input.baseId),
    ),
    fieldChangeRequest: os.bases.fieldChangeRequest.handler(({ input }) => {
      throw demoUnsupported(`${operationLabel(input.operation)} Field change request`);
    }),
    previewFieldConversion: os.bases.previewFieldConversion.handler(() => {
      throw demoUnsupported("Preview Field conversion");
    }),
    lifecycleChangeRequest: os.bases.lifecycleChangeRequest.handler(({ input }) => {
      throw demoUnsupported(`${operationLabel(input.operation)} Base change request`);
    }),
    listDeletedFields: os.bases.listDeletedFields.handler(() => []),
  },
  fileTrees: {
    create: os.fileTrees.create.handler(({ input }) => {
      throw demoUnsupported(`Create ${fileTreeLabel(input.type)}`);
    }),
    listFiles: os.fileTrees.listFiles.handler(
      ({ input }) => demoGetFileTree(input.nodeId, input.type).files,
    ),
    readFile: os.fileTrees.readFile.handler(({ input }) =>
      demoReadFileTreeFile(input.nodeId, input.filePath, input.type),
    ),
    createChangeRequest: os.fileTrees.createChangeRequest.handler(({ input }) => {
      throw demoUnsupported(`${fileTreeLabel(input.type)} change request`);
    }),
  },
  airapps: {
    // Server-side process execution has no meaningful demo equivalent (no
    // filesystem/process to spawn against in the stateless demo dataset).
    runLocal: os.airapps.runLocal.handler(() => {
      throw demoUnsupported("Local execution");
    }),
    stopLocal: os.airapps.stopLocal.handler(() => {
      throw demoUnsupported("Local execution");
    }),
  },
  files: {
    create: os.files.create.handler(() => {
      throw demoUnsupported("Create File");
    }),
  },
  docs: {
    create: os.docs.create.handler(() => {
      throw demoUnsupported("Create Doc");
    }),
    // The Doc body is already fully in memory on the demo dataset (same as
    // `nodes.get` relies on), so — unlike `assets.readTextLines` below, which
    // needs real per-asset storage the demo dataset doesn't have —
    // `readLines` gets a real, working demo implementation.
    // `updateBody` / `createChangeRequest` are gone: both write paths (Doc's,
    // and now whiteboard/workflow/html's too) unified into `nodes.updateContent`
    // above.
  },
  forms: {
    // A seeded demo Form renders its agent-authored page (read from the demo
    // scenario). Config edits still require a persistent instance; a submit is
    // acknowledged with a synthetic pending id so the approval-first flow reads
    // correctly, but nothing is stored.
    list: os.forms.list.handler(() => {
      throw demoUnsupported("List forms");
    }),
    getByNode: os.forms.getByNode.handler(({ input }) => {
      const form = demoGetForm(input.nodeId);
      if (!form) {
        throw new ORPCError("NOT_FOUND", { message: `Form not found: ${input.nodeId}` });
      }
      return form;
    }),
    create: os.forms.create.handler(() => {
      throw demoUnsupported("Create form");
    }),
    update: os.forms.update.handler(() => {
      throw demoUnsupported("Update form");
    }),
    submit: os.forms.submit.handler(() => demoSubmitForm()),
  },
  assets: {
    createUploadUrl: os.assets.createUploadUrl.handler(() => {
      throw demoUnsupported("Upload asset");
    }),
    confirm: os.assets.confirm.handler(() => {
      throw demoUnsupported("Upload asset");
    }),
    list: os.assets.list.handler(({ input }) => demoListAssets(input)),
    get: os.assets.get.handler(({ input }) => demoGetAsset(input.assetId)),
    updateMetadata: os.assets.updateMetadata.handler(() => {
      throw demoUnsupported("Update asset metadata");
    }),
    delete: os.assets.delete.handler(() => {
      throw demoUnsupported("Delete asset");
    }),
    download: os.assets.download.handler(() => {
      throw demoUnsupported("Download asset");
    }),
    // Drive Grep Retrieval needs real per-asset object storage (text slots,
    // the grep cache) that the stateless in-memory demo dataset doesn't
    // back — same "no real storage" boundary as uploads/updates/deletes above.
    putText: os.assets.putText.handler(() => {
      throw demoUnsupported("Write asset text");
    }),
    createTextUploadUrl: os.assets.createTextUploadUrl.handler(() => {
      throw demoUnsupported("Write asset text");
    }),
    readTextLines: os.assets.readTextLines.handler(() => {
      throw demoUnsupported("Read asset text lines");
    }),
    // editContent needs a real Drive/Skill mount + the filetree ChangeRequest
    // pipeline — same "no real storage" boundary as the rest of this slice.
    editContent: os.assets.editContent.handler(() => {
      throw demoUnsupported("Edit asset content");
    }),
  },
  vault: {
    get: os.vault.get.handler(() => ({
      ownerId: "demo-user",
      items: [],
      updatedAt: null,
    })),
    update: os.vault.update.handler(() => {
      throw demoUnsupported("Update Vault");
    }),
    clear: os.vault.clear.handler(() => {
      throw demoUnsupported("Clear Vault");
    }),
  },
  agents: {
    // Demo mode cannot spawn a process or hold a socket, so the catalog renders
    // with everything explicitly unavailable rather than pretending otherwise.
    catalog: os.agents.catalog.handler(() => [
      {
        slug: "claude-acp",
        name: "Claude Code",
        description: "Anthropic's Claude, wrapped for ACP. Runs on this machine.",
        transport: "local-subprocess" as const,
        version: null,
        available: false,
        comingSoon: false,
        unavailableReason: "Connecting to agents is disabled in the demo.",
      },
      {
        slug: "codex-acp",
        name: "Codex CLI",
        description: "OpenAI's Codex CLI, wrapped for ACP. Runs on this machine.",
        transport: "local-subprocess" as const,
        version: null,
        available: false,
        comingSoon: false,
        unavailableReason: "Connecting to agents is disabled in the demo.",
      },
      {
        slug: "buda",
        name: "Buda AI Agent",
        description: "A hosted Buda agent. Runs in Buda's cloud — nothing is installed locally.",
        transport: "remote-websocket" as const,
        version: null,
        available: false,
        unavailableReason: "Connecting to agents is disabled in the demo.",
      },
    ]),
    connections: {
      list: os.agents.connections.list.handler(() => []),
    },
    disconnect: os.agents.disconnect.handler(() => {
      throw demoUnsupported("Delete an agent connection");
    }),
    sessions: {
      list: os.agents.sessions.list.handler(() => []),
      create: os.agents.sessions.create.handler(() => {
        throw demoUnsupported("Connect to an agent");
      }),
      prompt: os.agents.sessions.prompt.handler(() => {
        throw demoUnsupported("Message an agent");
      }),
      cancel: os.agents.sessions.cancel.handler(() => ({ ok: true })),
      respondToPermission: os.agents.sessions.respondToPermission.handler(() => ({ ok: true })),
      close: os.agents.sessions.close.handler(() => ({ ok: true })),
      // Demo mode can never have a live session, because `create` refuses. So
      // this closes immediately instead of hanging a subscriber forever — the
      // UI's empty state is what the demo user should see, not a spinner.
      subscribe: os.agents.sessions.subscribe.handler(async function* () {}),
    },
  },
  webhooks: {
    list: os.webhooks.list.handler(() => []),
    get: os.webhooks.get.handler(() => {
      throw demoUnsupported("Open webhook rule");
    }),
    create: os.webhooks.create.handler(() => {
      throw demoUnsupported("Create webhook rule");
    }),
    update: os.webhooks.update.handler(() => {
      throw demoUnsupported("Update webhook rule");
    }),
    delete: os.webhooks.delete.handler(() => {
      throw demoUnsupported("Delete webhook rule");
    }),
    deliveries: os.webhooks.deliveries.handler(() => []),
    testFire: os.webhooks.testFire.handler(() => {
      throw demoUnsupported("Test-fire webhook rule");
    }),
  },
  // Dump domain needs real per-space DB rows and object storage the stateless
  // in-memory demo dataset doesn't have — unsupported in demo mode.
  dump: {
    exportTables: os.dump.exportTables.handler(() => {
      throw demoUnsupported("Export space");
    }),
    exportAssetText: os.dump.exportAssetText.handler(() => {
      throw demoUnsupported("Export space");
    }),
    exportDocBodies: os.dump.exportDocBodies.handler(() => {
      throw demoUnsupported("Export space");
    }),
    importBegin: os.dump.importBegin.handler(() => {
      throw demoUnsupported("Import space");
    }),
    importTables: os.dump.importTables.handler(() => {
      throw demoUnsupported("Import space");
    }),
    importCommit: os.dump.importCommit.handler(() => {
      throw demoUnsupported("Import space");
    }),
    importAbort: os.dump.importAbort.handler(() => {
      throw demoUnsupported("Import space");
    }),
  },
  // Install writes a real node tree, Bases and change requests, and fetches from
  // GitHub to do it — neither the writes nor the outbound request has anywhere to
  // land in the stateless in-memory demo dataset.
  install: {
    planFromGithub: os.install.planFromGithub.handler(() => {
      throw demoUnsupported("Install from GitHub");
    }),
    fromGithub: os.install.fromGithub.handler(() => {
      throw demoUnsupported("Install from GitHub");
    }),
  },
  // The catalog IS servable in demo mode, and deliberately is: it lists public
  // repositories and says nothing about a workspace, so the demo can show the
  // Template Center for real instead of an error card. Installing still is not
  // — that would need somewhere to install into.
  templates: {
    list: os.templates.list.handler(async ({ input }) => listTemplates(input)),
  },
  // The manual is static text about how Busabase works, not workspace data, so
  // demo mode serves the real thing rather than a stub — an agent exploring a
  // demo should be reading the same rules it will be held to on a real space.
  guides: guidesRouter,
  changeRequests: {
    list: os.changeRequests.list.handler(async ({ input }) => {
      const all = await demoListChangeRequests();
      const status = input?.status ?? [];
      const mine = input?.mine ?? false;
      const changeRequests = all.filter((changeRequest) => {
        if (status.length > 0 && !status.includes(changeRequest.status)) {
          return false;
        }
        if (mine && changeRequest.submittedBy !== "local-editor") {
          return false;
        }
        return demoChangeRequestAffectsNode(changeRequest, input?.affectsNodeId);
      });
      return { changeRequests, nextCursor: null };
    }),
    listPage: os.changeRequests.listPage.handler(async ({ input }) => {
      const all = await demoListChangeRequests();
      const status = input?.status ?? [];
      const mine = input?.mine ?? false;
      const matching = all.filter((changeRequest) => {
        if (status.length > 0 && !status.includes(changeRequest.status)) {
          return false;
        }
        if (mine && changeRequest.submittedBy !== "local-editor") {
          return false;
        }
        return demoChangeRequestAffectsNode(changeRequest, input?.affectsNodeId);
      });
      const pageSize = input?.pageSize ?? 50;
      const total = matching.length;
      const totalPages = Math.ceil(total / pageSize);
      const page = totalPages === 0 ? 1 : Math.min(input?.page ?? 1, totalPages);
      const offset = (page - 1) * pageSize;
      return {
        changeRequests: matching.slice(offset, offset + pageSize),
        total,
        totalPages,
        page,
        pageSize,
      };
    }),
    inboxSnapshot: os.changeRequests.inboxSnapshot.handler(async ({ input }) => {
      const all = await demoListChangeRequests();
      const countBy = (predicate: (changeRequest: (typeof all)[number]) => boolean) =>
        all.filter(predicate).length;
      const status = input?.status ?? [];
      const mine = input?.mine ?? false;
      const matching = all.filter((changeRequest) => {
        if (status.length > 0 && !status.includes(changeRequest.status)) return false;
        // No node scoping here: the badges below are whole-space, so the page
        // must be too (see `inboxSnapshotInputSchema` in busabase-contract).
        return !mine || changeRequest.submittedBy === "local-editor";
      });
      const pageSize = input?.pageSize ?? 50;
      const total = matching.length;
      const totalPages = Math.ceil(total / pageSize);
      const page = totalPages === 0 ? 1 : Math.min(input?.page ?? 1, totalPages);
      const offset = (page - 1) * pageSize;
      return {
        counts: {
          review: countBy((changeRequest) => changeRequest.status === "in_review"),
          changes: countBy((changeRequest) => changeRequest.status === "changes_requested"),
          created: countBy((changeRequest) => changeRequest.submittedBy === "local-editor"),
          approved: countBy((changeRequest) => changeRequest.status === "approved"),
          merged: countBy((changeRequest) => changeRequest.status === "merged"),
          rejected: countBy(
            (changeRequest) =>
              changeRequest.status === "rejected" || changeRequest.status === "abandoned",
          ),
        },
        changeRequests: matching.slice(offset, offset + pageSize),
        total,
        totalPages,
        page,
        pageSize,
      };
    }),
    counts: os.changeRequests.counts.handler(async () => {
      const all = await demoListChangeRequests();
      const countBy = (predicate: (changeRequest: (typeof all)[number]) => boolean) =>
        all.filter(predicate).length;
      return {
        review: countBy((changeRequest) => changeRequest.status === "in_review"),
        changes: countBy((changeRequest) => changeRequest.status === "changes_requested"),
        created: countBy((changeRequest) => changeRequest.submittedBy === "local-editor"),
        approved: countBy((changeRequest) => changeRequest.status === "approved"),
        merged: countBy((changeRequest) => changeRequest.status === "merged"),
        rejected: countBy(
          (changeRequest) =>
            changeRequest.status === "rejected" || changeRequest.status === "abandoned",
        ),
      };
    }),
    get: os.changeRequests.get.handler(({ input }) => demoGetChangeRequest(input.changeRequestId)),
    review: os.changeRequests.review.handler(({ input }) => {
      const { changeRequestIds, ...review } = input;
      return {
        results: changeRequestIds.map((changeRequestId) => {
          try {
            const changeRequest = demoReviewChangeRequest(changeRequestId, review);
            return {
              changeRequestId,
              ok: true as const,
              status: changeRequest.status,
              changeRequest,
            };
          } catch (error) {
            return demoBatchFailure(changeRequestId, error);
          }
        }),
      };
    }),
    close: os.changeRequests.close.handler(({ input }) =>
      demoCloseChangeRequest(input.changeRequestId, input.reason),
    ),
    merge: os.changeRequests.merge.handler(({ input }) => {
      return {
        results: input.changeRequestIds.map((changeRequestId) => {
          try {
            const merged = demoMergeChangeRequest(changeRequestId);
            return {
              changeRequestId,
              ok: true as const,
              status: merged.changeRequest.status,
              ...merged,
            };
          } catch (error) {
            return demoBatchFailure(changeRequestId, error);
          }
        }),
      };
    }),
  },
  operations: {
    revise: os.operations.revise.handler(({ input }) => demoReviseOperation(input.operationId)),
  },
  records: {
    list: os.records.list.handler(async ({ input }) => {
      if (input.status === "archived") return { records: [], nextCursor: null };
      const all = await demoListRecords({ baseId: input.baseId });
      const offset = getDemoRecordOffset(input.cursor);
      const nextOffset = offset + input.limit;
      return {
        records: all.slice(offset, nextOffset),
        nextCursor: nextOffset < all.length ? `${DEMO_RECORD_CURSOR_PREFIX}${nextOffset}` : null,
      };
    }),
    listPage: os.records.listPage.handler(async ({ input }) => {
      const base = demoGetBase(input.baseId);
      const view = input.viewId
        ? demoListViews(base.id).find((item) => item.id === input.viewId)
        : undefined;
      if (input.viewId && !view) {
        throw new ORPCError("NOT_FOUND", { message: `View not found: ${input.viewId}` });
      }
      let scoped = await demoListRecords({ baseId: base.id });
      if (input.dateRange) {
        const rangeField = base.fields.find((field) => field.slug === input.dateRange?.fieldSlug);
        if (!rangeField) {
          throw new ORPCError("NOT_FOUND", {
            message: `Field not found in Base ${base.id}: ${input.dateRange.fieldSlug}`,
          });
        }
        if (!DATE_RANGE_FIELD_TYPES.has(rangeField.type)) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Cannot scope by a ${rangeField.type} field: ${rangeField.slug}. dateRange requires one of: ${[...DATE_RANGE_FIELD_TYPES].join(", ")}.`,
          });
        }
        const gteMs = new Date(input.dateRange.gte).getTime();
        const ltMs = new Date(input.dateRange.lt).getTime();
        const { fieldSlug } = input.dateRange;
        scoped = scoped.filter((record) => {
          const raw = record.headCommit.payload[fieldSlug];
          if (typeof raw !== "string") return false;
          const ms = new Date(raw).getTime();
          return !Number.isNaN(ms) && ms >= gteMs && ms < ltMs;
        });
      }
      // The View's filters AND any ad-hoc ones, exactly as the real handler
      // merges them — a demo board column must page the same way a real one does.
      const ordered = applyViewConfigToRecords(
        scoped,
        input.filters?.length || view
          ? {
              filters: [...(view?.config.filters ?? []), ...(input.filters ?? [])],
              sorts: view?.config.sorts ?? [],
            }
          : undefined,
      );
      const total = ordered.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const page = totalPages === 0 ? 1 : Math.min(input.page, totalPages);
      const offset = (page - 1) * input.pageSize;
      return {
        records: ordered.slice(offset, offset + input.pageSize),
        total,
        totalPages,
        page,
        pageSize: input.pageSize,
      };
    }),
    count: os.records.count.handler(async ({ input }) => {
      // Demo mode has no SQL to push down to — the whole space is already an
      // in-memory VO array, so counting a viewId/filters combination is just
      // the same `applyViewConfigToRecords` real mode falls back to, run over
      // every candidate. Kept exact in lockstep with the real handler so demo
      // mode never shows a different total than a real Base would.
      const all = await demoListRecords({ baseId: input?.baseId });
      if (!input?.viewId && !input?.filters?.length) {
        return { total: all.length };
      }
      const base = input.baseId ? demoGetBase(input.baseId) : undefined;
      const view = input.viewId
        ? demoListViews(base?.id).find((item) => item.id === input.viewId)
        : undefined;
      if (input.viewId && !view) {
        throw new ORPCError("NOT_FOUND", { message: `View not found: ${input.viewId}` });
      }
      const viewFilters = view?.config.filters ?? [];
      const matched = applyViewConfigToRecords(all, {
        filters: [...viewFilters, ...(input.filters ?? [])],
        sorts: [],
      });
      return { total: matched.length };
    }),
    groupBy: os.records.groupBy.handler(async ({ input }) => {
      // Same story as `count` above: no SQL to group in, so this runs the exact
      // fallback the real handler keeps for un-pushable filters, over the demo
      // space's in-memory VOs. Kept in lockstep so a demo board's column counts
      // match what a real Base would report.
      const base = demoGetBase(input.baseId);
      if (!base) {
        throw new ORPCError("NOT_FOUND", { message: `Base not found: ${input.baseId}` });
      }
      const field = base.fields.find((entry) => entry.slug === input.fieldSlug);
      if (!field) {
        throw new ORPCError("NOT_FOUND", {
          message: `Field not found in Base ${input.baseId}: ${input.fieldSlug}`,
        });
      }
      if (!GROUPABLE_FIELD_TYPES.has(field.type)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Cannot group by a ${field.type} field: ${input.fieldSlug}. Groupable types: ${[...GROUPABLE_FIELD_TYPES].join(", ")}.`,
        });
      }
      const view = input.viewId
        ? demoListViews(base.id).find((item) => item.id === input.viewId)
        : undefined;
      if (input.viewId && !view) {
        throw new ORPCError("NOT_FOUND", { message: `View not found: ${input.viewId}` });
      }
      const matched = applyViewConfigToRecords(await demoListRecords({ baseId: base.id }), {
        filters: [...(view?.config.filters ?? []), ...(input.filters ?? [])],
        sorts: [],
      });
      const counts = new Map<string | null, number>();
      for (const record of matched) {
        const key = groupKeyForValue(record.headCommit.payload[input.fieldSlug], field.type);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const groups = [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => {
          if (left.value === right.value) return 0;
          if (left.value === null) return 1;
          if (right.value === null) return -1;
          return left.value < right.value ? -1 : 1;
        });
      return { groups, total: groups.reduce((sum, group) => sum + group.count, 0) };
    }),
    get: os.records.get.handler(({ input }) => {
      const record =
        "recordId" in input ? demoGetRecord(input.recordId) : demoGetRecordByField(input);
      if (!record) {
        throw new ORPCError("NOT_FOUND", { message: "Record not found" });
      }
      return record;
    }),
    search: os.records.search.handler(({ input }) => demoListRecordsByFieldText(input)),
    changeRequest: os.records.changeRequest.handler(({ input }) => {
      switch (input.operation) {
        case "update": {
          const { recordId, operation: _op, ...rest } = input;
          return { ...demoCreateUpdateChangeRequest(recordId, rest), materialized: false as const };
        }
        case "delete":
          return {
            ...demoCreateDeleteChangeRequest(input.recordId),
            materialized: false as const,
          };
        case "restore":
          throw demoUnsupported("Restore Record change request");
      }
    }),
    listChangeRequests: os.records.listChangeRequests.handler(({ input }) =>
      demoListRecordChangeRequests(input.recordId),
    ),
    listLinks: os.records.listLinks.handler(() => []),
  },
  views: {
    changeRequest: os.views.changeRequest.handler(({ input }) => {
      throw demoUnsupported(`${operationLabel(input.operation)} View change request`);
    }),
  },
});
