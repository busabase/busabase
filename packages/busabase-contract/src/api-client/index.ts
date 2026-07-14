import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import type {
  ConfirmUploadDTO,
  ConfirmUploadVO,
  RequestUploadUrlDTO,
  RequestUploadUrlVO,
} from "open-domains/attachments/types";
import type { iString } from "openlib/i18n/i-string";
import { type BusabaseContract, busabaseContract } from "../contract/busabase";
import type { CreatableNodeType } from "../domains/registry";
import type {
  AgentTaskVO,
  AssetDetailVO,
  AuditEventVO,
  BaseVO,
  ChangeRequestBatchResultVO,
  ChangeRequestVO,
  CommentSubjectType,
  CommentVO,
  DriveReadFileVO,
  DriveVO,
  NodeVO,
  RecordVO,
  SearchResponseVO,
  SkillReadFileVO,
  SkillVO,
  ViewConfigVO,
  ViewVO,
} from "../types";

export interface BusabaseListOptions {
  limit?: number;
}

export interface BusabaseRecordFieldTextFilter extends BusabaseListOptions {
  baseId?: string;
  fieldSlug: string;
  valueText: string;
}

export interface BusabaseSearchOptions {
  limit?: number;
  offset?: number;
  query: string;
}

export interface BusabaseDashboardApiClient {
  search: (options: BusabaseSearchOptions) => Promise<SearchResponseVO>;
  listAuditEvents: (options?: BusabaseListOptions) => Promise<AuditEventVO[]>;
  createAuditEvent: (payload: {
    action: AuditEventVO["action"];
    actorId?: string;
    baseId?: string | null;
    recordId?: string | null;
    changeRequestId?: string | null;
    operationId?: string | null;
    commitId?: string | null;
    metadata?: Record<string, unknown>;
  }) => Promise<AuditEventVO>;
  listComments: (subject: {
    subjectType: CommentSubjectType;
    subjectId: string;
  }) => Promise<CommentVO[]>;
  listAgentTasks: () => Promise<AgentTaskVO[]>;
  createComment: (payload: {
    authorId?: string;
    body: string;
    mentionsAi?: boolean;
    subjectType: CommentSubjectType;
    subjectId: string;
  }) => Promise<CommentVO>;
  listNodes: () => Promise<NodeVO[]>;
  /**
   * Load a single node's children (used by the sidebar's lazy per-folder
   * expand once the depth-bounded eager prefetch bottoms out at a node with
   * `hasChildren: true` but no loaded `children`). `depth` controls how many
   * additional levels beneath the returned children are eagerly included.
   */
  listNodeChildren: (parentId: string, depth?: number) => Promise<NodeVO[]>;
  /**
   * Server-authoritative check: is `nodeId` a descendant of
   * `potentialAncestorId` (walks the parentId chain)? Gates cross-branch
   * drag-and-drop drops when the full tree may not be loaded client-side.
   */
  isNodeDescendant: (params: {
    nodeId: string;
    potentialAncestorId: string;
  }) => Promise<{ isDescendant: boolean }>;
  getSkill: (nodeIdOrSlug: string) => Promise<SkillVO>;
  readSkillFile: (nodeId: string, filePath: string) => Promise<SkillReadFileVO>;
  getDrive: (nodeIdOrSlug: string) => Promise<DriveVO>;
  readDriveFile: (nodeId: string, filePath: string) => Promise<DriveReadFileVO>;
  listChangeRequests: (options?: BusabaseListOptions) => Promise<ChangeRequestVO[]>;
  getChangeRequest: (changeRequestId: string) => Promise<ChangeRequestVO>;
  listRecords: (options?: BusabaseListOptions) => Promise<RecordVO[]>;
  getRecord: (recordId: string) => Promise<RecordVO>;
  listRecordChangeRequests: (recordId: string) => Promise<ChangeRequestVO[]>;
  searchRecords: (filter: BusabaseRecordFieldTextFilter) => Promise<RecordVO[]>;
  listBases: () => Promise<BaseVO[]>;
  createBase: (payload: {
    parentNodeId?: string;
    slug: string;
    name: string;
    description?: string;
    fields: Array<{
      slug: string;
      name: iString;
      type?: BaseVO["fields"][number]["type"];
      required?: boolean;
    }>;
    // Review-first by default: without `autoMerge: true`, returns a pending
    // ChangeRequestVO instead of the materialized BaseVO.
    autoMerge?: boolean;
  }) => Promise<BaseVO | ChangeRequestVO>;
  createNodeChangeRequest: (payload: {
    message?: string;
    submittedBy?: string;
    autoMerge?: boolean;
    operations: Array<
      | {
          kind: "create";
          parentNodeId?: string;
          nodeType: CreatableNodeType;
          slug: string;
          name: string;
          description?: string;
          metadata?: Record<string, unknown>;
          fields?: Array<{
            slug: string;
            name: iString;
            type?: BaseVO["fields"][number]["type"];
            required?: boolean;
          }>;
        }
      | {
          kind: "rename";
          nodeId: string;
          slug?: string;
          name?: string;
          description?: string;
        }
      | { kind: "delete"; nodeId: string }
      | { kind: "restore"; nodeId: string }
    >;
  }) => Promise<ChangeRequestVO>;
  listArchivedNodes: () => Promise<NodeVO[]>;
  purgeNode: (nodeId: string) => Promise<{ purged: boolean }>;
  /**
   * Move/reorder a node — auto-merges immediately (no human review), since
   * repositioning a node in the tree is a low-risk structural tweak rather
   * than a content change. Backs the sidebar's drag-and-drop.
   */
  moveNode: (payload: {
    nodeId: string;
    parentNodeId?: string;
    position?: number;
    message?: string;
    submittedBy?: string;
  }) => Promise<ChangeRequestVO>;
  listViews: (baseId: string) => Promise<ViewVO[]>;
  createBaseField: (
    baseId: string,
    payload: {
      name: iString;
      options?: {
        ai?: {
          model?: string;
          prompt?: string;
          reviewRequired?: boolean;
          sourceFieldIds?: string[];
        };
        choices?: Array<{
          color?: string;
          id: string;
          name: string;
        }>;
        inverseFieldId?: string;
        multiple?: boolean;
        targetBaseId?: string;
      };
      required?: boolean;
      slug: string;
      type?: BaseVO["fields"][number]["type"];
    },
  ) => Promise<BaseVO>;
  createFieldChangeRequest: (
    baseId: string,
    payload: {
      name: iString;
      slug: string;
      type?: BaseVO["fields"][number]["type"];
      required?: boolean;
      options?: {
        ai?: {
          model?: string;
          prompt?: string;
          reviewRequired?: boolean;
          sourceFieldIds?: string[];
        };
        choices?: Array<{ color?: string; id: string; name: string }>;
        inverseFieldId?: string;
        multiple?: boolean;
        targetBaseId?: string;
      };
      message?: string;
      submittedBy?: string;
    },
  ) => Promise<ChangeRequestVO>;
  createUpdateFieldChangeRequest: (
    baseId: string,
    payload: {
      fieldId: string;
      patch: {
        name?: iString;
        required?: boolean;
        options?: {
          ai?: {
            model?: string;
            prompt?: string;
            reviewRequired?: boolean;
            sourceFieldIds?: string[];
          };
          choices?: Array<{ color?: string; id: string; name: string }>;
          inverseFieldId?: string;
          multiple?: boolean;
          targetBaseId?: string;
        };
      };
      message?: string;
      submittedBy?: string;
    },
  ) => Promise<ChangeRequestVO>;
  createViewChangeRequest: (
    baseId: string,
    payload: {
      config?: ViewConfigVO;
      description?: string;
      message?: string;
      name: string;
      slug: string;
      submittedBy?: string;
    },
  ) => Promise<ChangeRequestVO>;
  createUpdateViewChangeRequest: (
    viewId: string,
    payload: {
      config?: ViewConfigVO;
      description?: string;
      message?: string;
      name?: string;
      submittedBy?: string;
    },
  ) => Promise<ChangeRequestVO>;
  createDeleteViewChangeRequest: (viewId: string) => Promise<ChangeRequestVO>;
  approveChangeRequest: (changeRequestId: string, reason?: string) => Promise<ChangeRequestVO>;
  rejectChangeRequest: (changeRequestId: string, reason?: string) => Promise<ChangeRequestVO>;
  closeChangeRequest: (changeRequestId: string, reason?: string) => Promise<ChangeRequestVO>;
  reviewChangeRequestsMany: (
    changeRequestIds: string[],
    verdict: "approved" | "rejected",
    reason?: string,
  ) => Promise<ChangeRequestBatchResultVO>;
  mergeChangeRequestsMany: (changeRequestIds: string[]) => Promise<ChangeRequestBatchResultVO>;
  reviseOperation: (
    operationId: string,
    payload: { fields: Record<string, unknown>; message?: string; author?: string },
  ) => Promise<ChangeRequestVO>;
  createChangeRequest: (
    baseId: string,
    payload: { fields: Record<string, unknown>; message?: string; submittedBy?: string },
  ) => Promise<ChangeRequestVO>;
  createUpdateChangeRequest: (
    recordId: string,
    payload: { fields: Record<string, unknown>; message?: string; author?: string },
  ) => Promise<ChangeRequestVO>;
  createDeleteChangeRequest: (recordId: string) => Promise<ChangeRequestVO>;
  mergeChangeRequest: (
    changeRequestId: string,
  ) => Promise<{ changeRequest: ChangeRequestVO; record: RecordVO | null; view: ViewVO | null }>;
  createAssetUploadUrl: (input: RequestUploadUrlDTO) => Promise<RequestUploadUrlVO>;
  confirmAsset: (input: ConfirmUploadDTO) => Promise<ConfirmUploadVO>;
  updateAssetMetadata: (input: {
    assetId: string;
    metadata: Record<string, unknown>;
    mode?: "merge" | "replace";
  }) => Promise<AssetDetailVO>;
  createRestoreBaseChangeRequest: (
    baseId: string,
    payload: { submittedBy?: string; message?: string },
  ) => Promise<ChangeRequestVO>;
  createRestoreFieldChangeRequest: (
    baseId: string,
    payload: { fieldId: string; submittedBy?: string; message?: string },
  ) => Promise<ChangeRequestVO>;
  listArchivedViews: (baseId: string) => Promise<ViewVO[]>;
  listArchivedRecords: (baseId: string) => Promise<RecordVO[]>;
  createRestoreViewChangeRequest: (
    viewId: string,
    payload: { submittedBy?: string; message?: string },
  ) => Promise<ChangeRequestVO>;
  createRestoreRecordChangeRequest: (
    recordId: string,
    payload: { submittedBy?: string; message?: string },
  ) => Promise<ChangeRequestVO>;
}

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

export const resolveApiUrl = (apiBasePath: string) => {
  if (/^https?:\/\//.test(apiBasePath)) {
    return apiBasePath;
  }
  return `${getBaseUrl()}${apiBasePath}`;
};

// Uses plain POST for every call (not `inferRPCMethodFromContractRouter`): the
// server's /api/rpc handler is oRPC's `RPCHandler`, which is POST-only and does
// not honor the contract's `.route({ method })` metadata, so sending the
// contract-declared verb (e.g. PUT for records.updateChangeRequest) 405s.
export const createBusabaseORPCClient = (
  apiBasePath = "/api/rpc",
  opts?: {
    headers?:
      | Record<string, string>
      | (() => Record<string, string> | Promise<Record<string, string>>);
  },
): ContractRouterClient<BusabaseContract> => {
  const link = new RPCLink({
    url: resolveApiUrl(apiBasePath),
    headers: async () =>
      (typeof opts?.headers === "function" ? await opts.headers() : opts?.headers) ?? {},
  });

  return createORPCClient(link);
};

export const createBusabaseOpenApiClient = (options: {
  baseUrl: string;
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
}): ContractRouterClient<BusabaseContract> => {
  const link = new OpenAPILink(busabaseContract, {
    url: options.baseUrl.replace(/\/+$/, ""),
    headers: async () =>
      (typeof options.headers === "function" ? await options.headers() : options.headers) ?? {},
  });

  return createORPCClient(link);
};

export const createBusabaseRestApiClient = (
  apiBasePath = "/api/v1",
  opts?: {
    headers?:
      | Record<string, string>
      | (() => Record<string, string> | Promise<Record<string, string>>);
  },
): BusabaseDashboardApiClient => {
  const rpcPath = apiBasePath.endsWith("/v1")
    ? `${apiBasePath.slice(0, -"/v1".length)}/rpc`
    : apiBasePath;
  const client = createBusabaseORPCClient(rpcPath, opts);

  return {
    search: (options) => client.search(options),
    listAuditEvents: (options) => client.auditEvents.list(options ?? {}),
    createAuditEvent: (payload) => client.auditEvents.create(payload),
    listComments: (subject) => client.comments.list(subject),
    listAgentTasks: () => client.agent.listTasks({}),
    createComment: (payload) => client.comments.create(payload),
    listNodes: () => client.nodes.list(),
    listNodeChildren: (parentId, depth) => client.nodes.list({ parentId, depth }),
    isNodeDescendant: (params) => client.nodes.isDescendant(params),
    listArchivedNodes: () => client.nodes.listArchived(),
    purgeNode: (nodeId) => client.nodes.purge({ nodeId }),
    moveNode: (payload) => client.nodes.move(payload),
    getSkill: (nodeIdOrSlug) => client.skills.get({ nodeId: nodeIdOrSlug }),
    readSkillFile: (nodeId, filePath) => client.skills.readFile({ nodeId, filePath }),
    getDrive: (nodeIdOrSlug) => client.drives.get({ nodeId: nodeIdOrSlug }),
    readDriveFile: (nodeId, filePath) => client.drives.readFile({ nodeId, filePath }),
    listChangeRequests: (options) => client.changeRequests.list(options ?? {}),
    getChangeRequest: (changeRequestId) => client.changeRequests.get({ changeRequestId }),
    listRecords: (options) => client.records.list(options ?? {}),
    getRecord: (recordId) => client.records.get({ recordId }),
    listRecordChangeRequests: (recordId) => client.records.listChangeRequests({ recordId }),
    searchRecords: (filter) => client.records.search(filter),
    listBases: () => client.bases.list(),
    createBase: (payload) => client.bases.create(payload),
    createNodeChangeRequest: (payload) => client.nodes.createChangeRequest(payload),
    listViews: (baseId) => client.bases.listViews({ baseId }),
    createBaseField: (baseId, payload) => client.bases.createField({ baseId, ...payload }),
    createFieldChangeRequest: (baseId, payload) =>
      client.bases.createFieldChangeRequest({ baseId, ...payload }),
    createUpdateFieldChangeRequest: (baseId, payload) =>
      client.bases.updateFieldChangeRequest({ baseId, ...payload }),
    createViewChangeRequest: (baseId, payload) =>
      client.bases.createViewChangeRequest({ baseId, ...payload }),
    createUpdateViewChangeRequest: (viewId, payload) =>
      client.views.updateChangeRequest({ viewId, ...payload }),
    createDeleteViewChangeRequest: (viewId) => client.views.deleteChangeRequest({ viewId }),
    approveChangeRequest: (changeRequestId, reason) =>
      client.changeRequests.review(
        reason
          ? { changeRequestId, reason, verdict: "approved" }
          : { changeRequestId, verdict: "approved" },
      ),
    rejectChangeRequest: (changeRequestId, reason = "Requested changes from Busabase dashboard") =>
      client.changeRequests.review({
        changeRequestId,
        reason,
        verdict: "rejected",
      }),
    closeChangeRequest: (changeRequestId, reason) =>
      client.changeRequests.close(reason ? { changeRequestId, reason } : { changeRequestId }),
    reviewChangeRequestsMany: (changeRequestIds, verdict, reason) =>
      client.changeRequests.reviewMany(
        reason ? { changeRequestIds, verdict, reason } : { changeRequestIds, verdict },
      ),
    mergeChangeRequestsMany: (changeRequestIds) =>
      client.changeRequests.mergeMany({ changeRequestIds }),
    reviseOperation: (operationId, payload) =>
      client.operations.revise({ operationId, ...payload }),
    createChangeRequest: (baseId, payload) =>
      client.bases.createChangeRequest({ baseId, ...payload }),
    createUpdateChangeRequest: (recordId, payload) =>
      client.records.updateChangeRequest({ recordId, ...payload }),
    createDeleteChangeRequest: (recordId) =>
      client.records.deleteChangeRequest({ recordId, deleteMode: "archive" }),
    mergeChangeRequest: (changeRequestId) => client.changeRequests.merge({ changeRequestId }),
    createAssetUploadUrl: (input) => client.assets.createUploadUrl(input),
    confirmAsset: (input) => client.assets.confirm(input),
    updateAssetMetadata: (input) => client.assets.updateMetadata(input),
    createRestoreBaseChangeRequest: (baseId, payload) =>
      client.bases.restoreChangeRequest({ baseId, ...payload }),
    createRestoreFieldChangeRequest: (baseId, payload) =>
      client.bases.restoreFieldChangeRequest({ baseId, ...payload }),
    listArchivedViews: (baseId) => client.bases.listArchivedViews({ baseId }),
    listArchivedRecords: (baseId) => client.bases.listArchivedRecords({ baseId }),
    createRestoreViewChangeRequest: (viewId, payload) =>
      client.views.restoreChangeRequest({ viewId, ...payload }),
    createRestoreRecordChangeRequest: (recordId, payload) =>
      client.records.restoreChangeRequest({ recordId, ...payload }),
  };
};
