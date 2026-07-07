import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
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
  demoGetFolder,
  demoGetRecord,
  demoListAgentTasks,
  demoListAssets,
  demoListAuditEvents,
  demoListBases,
  demoListChangeRequests,
  demoListComments,
  demoListFolders,
  demoListNodes,
  demoListRecordChangeRequests,
  demoListRecords,
  demoListRecordsByFieldText,
  demoListViews,
  demoMergeChangeRequest,
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

const shouldEmitDemoLiveEvent = () => false;

export const busabaseDemoRouter = os.router({
  auth: {
    verify: os.auth.verify.handler(() => demoGetAuthInfo()),
  },
  search: os.search.handler(({ input }) => demoSearch(input)),
  nodes: {
    list: os.nodes.list.handler(() => demoListNodes()),
    listArchived: os.nodes.listArchived.handler(() => []),
    createChangeRequest: os.nodes.createChangeRequest.handler(() => {
      throw demoUnsupported("Node tree change request");
    }),
    purge: os.nodes.purge.handler(() => {
      throw demoUnsupported("Permanently delete node");
    }),
  },
  auditEvents: {
    list: os.auditEvents.list.handler(() => demoListAuditEvents()),
    create: os.auditEvents.create.handler(({ input }) => demoCreateAuditEvent(input)),
  },
  comments: {
    list: os.comments.list.handler(() => demoListComments()),
    create: os.comments.create.handler(({ input }) => demoCreateComment(input)),
  },
  agent: {
    listTasks: os.agent.listTasks.handler(() => demoListAgentTasks()),
  },
  live: {
    subscribe: os.live.subscribe.handler(async function* () {
      if (shouldEmitDemoLiveEvent()) {
        yield undefined as never;
      }
      return undefined;
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
  docs: {
    list: os.docs.list.handler(() => []),
    create: os.docs.create.handler(() => {
      throw demoUnsupported("Create Doc");
    }),
    get: os.docs.get.handler(() => {
      throw demoUnsupported("Open Doc");
    }),
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
    delete: os.assets.delete.handler(() => {
      throw demoUnsupported("Delete asset");
    }),
  },
  changeRequests: {
    list: os.changeRequests.list.handler(() => demoListChangeRequests()),
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
