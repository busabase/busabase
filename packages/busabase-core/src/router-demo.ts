import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "./contract/busabase";
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

export const busabaseDemoRouter = os.router({
  auth: {
    verify: os.auth.verify.handler(() => demoGetAuthInfo()),
  },
  search: os.search.handler(({ input }) => demoSearch(input)),
  nodes: {
    list: os.nodes.list.handler(() => demoListNodes()),
    createChangeRequest: os.nodes.createChangeRequest.handler(() => {
      throw demoUnsupported("Node tree change request");
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
  bases: {
    list: os.bases.list.handler(() => demoListBases()),
    create: os.bases.create.handler(() => {
      throw demoUnsupported("Create Base");
    }),
    createChangeRequest: os.bases.createChangeRequest.handler(({ input }) => {
      const { baseId, ...rest } = input;
      return demoCreateChangeRequest(baseId, rest);
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
  attachments: {
    createUploadUrl: os.attachments.createUploadUrl.handler(() => {
      throw demoUnsupported("Upload attachment");
    }),
    confirm: os.attachments.confirm.handler(() => {
      throw demoUnsupported("Upload attachment");
    }),
  },
  assets: {
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
    close: os.changeRequests.close.handler(({ input }) =>
      demoCloseChangeRequest(input.changeRequestId, input.reason),
    ),
    merge: os.changeRequests.merge.handler(({ input }) =>
      demoMergeChangeRequest(input.changeRequestId),
    ),
  },
  operations: {
    revise: os.operations.revise.handler(({ input }) => demoReviseOperation(input.operationId)),
  },
  records: {
    list: os.records.list.handler(() => demoListRecords()),
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
  },
  views: {
    updateChangeRequest: os.views.updateChangeRequest.handler(() => {
      throw demoUnsupported("Update View change request");
    }),
    deleteChangeRequest: os.views.deleteChangeRequest.handler(() => {
      throw demoUnsupported("Delete View change request");
    }),
  },
});
