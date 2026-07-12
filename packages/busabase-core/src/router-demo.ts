import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
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
  demoGetChangeRequest,
  demoGetDoc,
  demoGetFileNode,
  demoGetFolder,
  demoGetRecord,
  demoListAgentTasks,
  demoListAssets,
  demoListAuditEvents,
  demoListBases,
  demoListChangeRequests,
  demoListComments,
  demoListDocs,
  demoListFileNodes,
  demoListFolders,
  demoListNodes,
  demoListRecordChangeRequests,
  demoListRecords,
  demoListRecordsByFieldText,
  demoListViews,
  demoMergeChangeRequest,
  demoReadDocLines,
  demoReviewChangeRequest,
  demoReviseOperation,
  demoSearch,
} from "./logic/demo-store";

// Stateless demo router (productready-style): the request boundary swaps to this
// when `?demo` is present. It implements the SAME `busabaseContract` as the real
// `busabaseRouter`, but every handler reads the shared seed (`demo/dataset.ts`)
// and writes are synthetic + non-persistent. It never touches the db.
const os = implement(busabaseContract);

const demoUnsupported = (action: string) =>
  new ORPCError("FORBIDDEN", {
    message: `"${action}" is disabled in the Busabase demo. Run Busabase locally to make persistent changes.`,
  });

async function* subscribeDemoLiveEvents(signal?: AbortSignal) {
  while (!signal?.aborted) {
    await new Promise<void>((resolve) => {
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }
}

const shouldEmitDemoLiveEvent = () => false;

export const busabaseDemoRouter = os.router({
  auth: {
    verify: os.auth.verify.handler(() => demoGetAuthInfo()),
  },
  search: os.search.handler(({ input }) => demoSearch(input)),
  // Unified Grep (P2a) needs real per-source storage (Drive text slots +
  // Doc bodies) the stateless in-memory demo dataset doesn't have — same
  // boundary `assets.grep`/`assets.editContent` already draw below.
  grep: os.grep.handler(() => {
    throw demoUnsupported("Unified grep");
  }),
  nodes: {
    list: os.nodes.list.handler(() => demoListNodes()),
    listArchived: os.nodes.listArchived.handler(() => []),
    createChangeRequest: os.nodes.createChangeRequest.handler(() => {
      throw demoUnsupported("Node tree change request");
    }),
    move: os.nodes.move.handler(() => {
      throw demoUnsupported("Move node");
    }),
    purge: os.nodes.purge.handler(() => {
      throw demoUnsupported("Permanently delete node");
    }),
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
      // Demo data is small: return the newest page, no cursor.
      return { items: all.slice(0, limit), nextCursor: null };
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
    list: os.bases.list.handler(() => demoListBases()),
    listArchived: os.bases.listArchived.handler(() => []),
    get: os.bases.get.handler(() => null),
    create: os.bases.create.handler(() => {
      throw demoUnsupported("Create Base");
    }),
    createChangeRequest: os.bases.createChangeRequest.handler(({ input }) => {
      const { baseId, ...rest } = input;
      return demoCreateChangeRequest(baseId, rest);
    }),
    createBulkChangeRequest: os.bases.createBulkChangeRequest.handler(() => {
      throw demoUnsupported("Bulk record change request");
    }),
    createField: os.bases.createField.handler(() => {
      throw demoUnsupported("Create Base field");
    }),
    listViews: os.bases.listViews.handler(({ input }) => demoListViews(input.baseId)),
    createFieldChangeRequest: os.bases.createFieldChangeRequest.handler(() => {
      throw demoUnsupported("Create Field change request");
    }),
    createViewChangeRequest: os.bases.createViewChangeRequest.handler(() => {
      throw demoUnsupported("Create View change request");
    }),
    deleteFieldChangeRequest: os.bases.deleteFieldChangeRequest.handler(() => {
      throw demoUnsupported("Delete Field change request");
    }),
    updateFieldChangeRequest: os.bases.updateFieldChangeRequest.handler(() => {
      throw demoUnsupported("Update Field change request");
    }),
    previewFieldConversion: os.bases.previewFieldConversion.handler(() => {
      throw demoUnsupported("Preview Field conversion");
    }),
    convertFieldChangeRequest: os.bases.convertFieldChangeRequest.handler(() => {
      throw demoUnsupported("Convert Field change request");
    }),
    reorderFieldsChangeRequest: os.bases.reorderFieldsChangeRequest.handler(() => {
      throw demoUnsupported("Reorder Fields change request");
    }),
    archiveChangeRequest: os.bases.archiveChangeRequest.handler(() => {
      throw demoUnsupported("Archive Base change request");
    }),
    restoreChangeRequest: os.bases.restoreChangeRequest.handler(() => {
      throw demoUnsupported("Restore Base change request");
    }),
    restoreFieldChangeRequest: os.bases.restoreFieldChangeRequest.handler(() => {
      throw demoUnsupported("Restore Field change request");
    }),
    listDeletedFields: os.bases.listDeletedFields.handler(() => []),
    listArchivedViews: os.bases.listArchivedViews.handler(() => []),
    listArchivedRecords: os.bases.listArchivedRecords.handler(() => []),
    listArchivedRecordsPaged: os.bases.listArchivedRecordsPaged.handler(() => ({
      records: [],
      nextCursor: null,
    })),
  },
  skills: {
    list: os.skills.list.handler(() => []),
    create: os.skills.create.handler(() => {
      throw demoUnsupported("Create Skill");
    }),
    get: os.skills.get.handler(() => {
      throw demoUnsupported("Open Skill");
    }),
    listFiles: os.skills.listFiles.handler(() => []),
    readFile: os.skills.readFile.handler(() => {
      throw demoUnsupported("Read Skill file");
    }),
    createChangeRequest: os.skills.createChangeRequest.handler(() => {
      throw demoUnsupported("Skill change request");
    }),
  },
  drives: {
    list: os.drives.list.handler(() => []),
    create: os.drives.create.handler(() => {
      throw demoUnsupported("Create Drive");
    }),
    get: os.drives.get.handler(() => {
      throw demoUnsupported("Open Drive");
    }),
    listFiles: os.drives.listFiles.handler(() => []),
    readFile: os.drives.readFile.handler(() => {
      throw demoUnsupported("Read Drive file");
    }),
    createChangeRequest: os.drives.createChangeRequest.handler(() => {
      throw demoUnsupported("Drive change request");
    }),
  },
  airapps: {
    list: os.airapps.list.handler(() => []),
    create: os.airapps.create.handler(() => {
      throw demoUnsupported("Create AirApp");
    }),
    get: os.airapps.get.handler(() => {
      throw demoUnsupported("Open AirApp");
    }),
    listFiles: os.airapps.listFiles.handler(() => []),
    readFile: os.airapps.readFile.handler(() => {
      throw demoUnsupported("Read AirApp file");
    }),
    createChangeRequest: os.airapps.createChangeRequest.handler(() => {
      throw demoUnsupported("AirApp change request");
    }),
  },
  files: {
    list: os.files.list.handler(() => demoListFileNodes()),
    create: os.files.create.handler(() => {
      throw demoUnsupported("Create File");
    }),
    get: os.files.get.handler(({ input }) => demoGetFileNode(input.nodeId)),
  },
  docs: {
    list: os.docs.list.handler(() => demoListDocs()),
    create: os.docs.create.handler(() => {
      throw demoUnsupported("Create Doc");
    }),
    get: os.docs.get.handler(({ input }) => demoGetDoc(input.nodeId)),
    // The Doc body is already fully in memory on the demo dataset (same as
    // `get` above relies on), so — unlike `assets.readTextLines` below, which
    // needs real per-asset storage the demo dataset doesn't have —
    // `readLines` gets a real, working demo implementation.
    readLines: os.docs.readLines.handler(({ input }) =>
      demoReadDocLines(input.nodeId, input.startLine, input.endLine),
    ),
    updateBody: os.docs.updateBody.handler(() => {
      throw demoUnsupported("Update Doc");
    }),
    createChangeRequest: os.docs.createChangeRequest.handler(() => {
      throw demoUnsupported("Doc change request");
    }),
  },
  folders: {
    list: os.folders.list.handler(() => demoListFolders()),
    get: os.folders.get.handler(({ input }) => demoGetFolder(input.nodeId)),
  },
  assets: {
    createUploadUrl: os.assets.createUploadUrl.handler(() => {
      throw demoUnsupported("Upload asset");
    }),
    confirm: os.assets.confirm.handler(() => {
      throw demoUnsupported("Upload asset");
    }),
    list: os.assets.list.handler(() => demoListAssets()),
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
    grep: os.assets.grep.handler(() => {
      throw demoUnsupported("Grep assets");
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
  changeRequests: {
    list: os.changeRequests.list.handler(() => demoListChangeRequests()),
    listPaged: os.changeRequests.listPaged.handler(async ({ input }) => {
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
        return true;
      });
      return { changeRequests, nextCursor: null };
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
      const { changeRequestId, ...rest } = input;
      return demoReviewChangeRequest(changeRequestId, rest);
    }),
    reviewMany: os.changeRequests.reviewMany.handler(() => {
      throw demoUnsupported("Review many change requests");
    }),
    close: os.changeRequests.close.handler(({ input }) =>
      demoCloseChangeRequest(input.changeRequestId, input.reason),
    ),
    merge: os.changeRequests.merge.handler(({ input }) =>
      demoMergeChangeRequest(input.changeRequestId),
    ),
    mergeMany: os.changeRequests.mergeMany.handler(() => {
      throw demoUnsupported("Merge many change requests");
    }),
  },
  operations: {
    revise: os.operations.revise.handler(({ input }) => demoReviseOperation(input.operationId)),
  },
  records: {
    list: os.records.list.handler(() => demoListRecords()),
    listPaged: os.records.listPaged.handler(async () => ({
      records: await demoListRecords(),
      nextCursor: null,
    })),
    count: os.records.count.handler(async ({ input }) => {
      const all = await demoListRecords();
      const total = input?.baseId
        ? all.filter((record) => record.baseId === input.baseId).length
        : all.length;
      return { total };
    }),
    get: os.records.get.handler(({ input }) => demoGetRecord(input.recordId)),
    search: os.records.search.handler(({ input }) => demoListRecordsByFieldText(input)),
    updateChangeRequest: os.records.updateChangeRequest.handler(({ input }) => {
      const { recordId, ...rest } = input;
      return demoCreateUpdateChangeRequest(recordId, rest);
    }),
    deleteChangeRequest: os.records.deleteChangeRequest.handler(({ input }) =>
      demoCreateDeleteChangeRequest(input.recordId),
    ),
    listChangeRequests: os.records.listChangeRequests.handler(({ input }) =>
      demoListRecordChangeRequests(input.recordId),
    ),
    restoreChangeRequest: os.records.restoreChangeRequest.handler(() => {
      throw demoUnsupported("Restore Record change request");
    }),
    listLinks: os.records.listLinks.handler(() => []),
  },
  views: {
    updateChangeRequest: os.views.updateChangeRequest.handler(() => {
      throw demoUnsupported("Update View change request");
    }),
    deleteChangeRequest: os.views.deleteChangeRequest.handler(() => {
      throw demoUnsupported("Delete View change request");
    }),
    restoreChangeRequest: os.views.restoreChangeRequest.handler(() => {
      throw demoUnsupported("Restore View change request");
    }),
  },
});
