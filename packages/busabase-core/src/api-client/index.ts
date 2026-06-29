import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { type ContractRouterClient, inferRPCMethodFromContractRouter } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import type {
  ConfirmUploadDTO,
  ConfirmUploadVO,
  RequestUploadUrlDTO,
  RequestUploadUrlVO,
} from "open-domains/attachments/types";
import {
  type BusabaseContract,
  busabaseContract,
  searchResponseSchema,
} from "../contract/busabase";
import type { CreatableNodeType } from "../domains/registry";
import type {
  AgentTaskVO,
  AuditEventVO,
  BaseVO,
  ChangeRequestVO,
  CommentSubjectType,
  CommentVO,
  NodeVO,
  RecordVO,
  SearchResponseVO,
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
  getSkill: (nodeIdOrSlug: string) => Promise<SkillVO>;
  readSkillFile: (
    nodeId: string,
    filePath: string,
  ) => Promise<{ nodeId: string; path: string; content: string; contentHash: string }>;
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
      name: string;
      type?: BaseVO["fields"][number]["type"];
      required?: boolean;
    }>;
  }) => Promise<BaseVO>;
  createNodeChangeRequest: (payload: {
    message?: string;
    submittedBy?: string;
    operations: Array<
      | {
          kind: "create";
          parentNodeId?: string;
          nodeType: CreatableNodeType;
          slug: string;
          name: string;
          description?: string;
          fields?: Array<{
            slug: string;
            name: string;
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
  listViews: (baseId: string) => Promise<ViewVO[]>;
  createBaseField: (
    baseId: string,
    payload: {
      name: string;
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
      name: string;
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
  createAttachmentUploadUrl: (input: RequestUploadUrlDTO) => Promise<RequestUploadUrlVO>;
  confirmAttachment: (input: ConfirmUploadDTO) => Promise<ConfirmUploadVO>;
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

export const createBusabaseORPCClient = (
  apiBasePath = "/api/rpc",
): ContractRouterClient<BusabaseContract> => {
  const link = new RPCLink({
    method: inferRPCMethodFromContractRouter(busabaseContract),
    url: resolveApiUrl(apiBasePath),
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
): BusabaseDashboardApiClient => {
  const rpcPath = apiBasePath.endsWith("/v1")
    ? `${apiBasePath.slice(0, -"/v1".length)}/rpc`
    : apiBasePath;
  const client = createBusabaseORPCClient(rpcPath);

  return {
    search: (options) => fetchBusabaseSearch(apiBasePath, options),
    listAuditEvents: (options) => client.auditEvents.list(options ?? {}),
    createAuditEvent: (payload) => client.auditEvents.create(payload),
    listComments: (subject) => client.comments.list(subject),
    listAgentTasks: () => client.agent.listTasks({}),
    createComment: (payload) => client.comments.create(payload),
    listNodes: () => client.nodes.list(),
    listArchivedNodes: () => client.nodes.listArchived(),
    purgeNode: (nodeId) => client.nodes.purge({ nodeId }),
    // Skills go over plain REST, not oRPC: the RPC path /skills/get collides with
    // the server's REST matcher /skills/:id (same "skills" word). Same approach as search.
    getSkill: (nodeIdOrSlug) => fetchBusabaseSkill(apiBasePath, nodeIdOrSlug),
    readSkillFile: (nodeId, filePath) => fetchBusabaseSkillFile(apiBasePath, nodeId, filePath),
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
    reviseOperation: (operationId, payload) =>
      client.operations.revise({ operationId, ...payload }),
    createChangeRequest: (baseId, payload) =>
      client.bases.createChangeRequest({ baseId, ...payload }),
    createUpdateChangeRequest: (recordId, payload) =>
      client.records.updateChangeRequest({ recordId, ...payload }),
    createDeleteChangeRequest: (recordId) =>
      client.records.deleteChangeRequest({ recordId, deleteMode: "archive" }),
    mergeChangeRequest: (changeRequestId) => client.changeRequests.merge({ changeRequestId }),
    createAttachmentUploadUrl: (input) => client.attachments.createUploadUrl(input),
    confirmAttachment: (input) => client.attachments.confirm(input),
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

const fetchBusabaseSearch = async (
  apiBasePath: string,
  options: BusabaseSearchOptions,
): Promise<SearchResponseVO> => {
  const endpoint = new URL(`${resolveApiUrl(apiBasePath).replace(/\/$/, "")}/search`);
  endpoint.searchParams.set("query", options.query);
  if (options.limit !== undefined) {
    endpoint.searchParams.set("limit", String(options.limit));
  }
  if (options.offset !== undefined) {
    endpoint.searchParams.set("offset", String(options.offset));
  }

  const response = await fetch(endpoint, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Search failed with ${response.status}`);
  }
  return searchResponseSchema.parse(await response.json());
};

const fetchBusabaseSkill = async (apiBasePath: string, nodeIdOrSlug: string): Promise<SkillVO> => {
  const base = resolveApiUrl(apiBasePath).replace(/\/$/, "");
  const response = await fetch(`${base}/skills/${encodeURIComponent(nodeIdOrSlug)}`, {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(`Failed to load skill (${response.status})`);
  }
  return (await response.json()) as SkillVO;
};

const fetchBusabaseSkillFile = async (
  apiBasePath: string,
  nodeId: string,
  filePath: string,
): Promise<{ nodeId: string; path: string; content: string; contentHash: string }> => {
  const base = resolveApiUrl(apiBasePath).replace(/\/$/, "");
  // Preserve the path structure but encode each segment.
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `${base}/skills/${encodeURIComponent(nodeId)}/files/${encodedPath}`,
    { method: "GET" },
  );
  if (!response.ok) {
    throw new Error(`Failed to read file (${response.status})`);
  }
  return (await response.json()) as {
    nodeId: string;
    path: string;
    content: string;
    contentHash: string;
  };
};
