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
import type { NodeContentInput } from "../contract/node-content-schemas";
import type { NodeDetailVO } from "../contract/node-detail-schemas";
import type {
  InstallFromGithubDTO,
  InstallPlanFromGithubDTO,
  InstallPlanVO,
  InstallResultVO,
} from "../domains/install/types";
import type { CreatableNodeType } from "../domains/registry";
import type { ListTemplatesDTO, TemplateCatalogVO } from "../domains/templates/types";
import type {
  AgentTaskVO,
  AssetDetailVO,
  AuditEventVO,
  BaseVO,
  ChangeRequestMergeBatchResultVO,
  ChangeRequestReviewBatchResultVO,
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
  ViewType,
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

export type RecordUpdateChangeRequestResult =
  | (RecordVO & { materialized: true })
  | (ChangeRequestVO & { materialized: false });

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
  /** Shallow-merge top-level metadata keys on an active node. */
  updateNodeMetadata: (nodeId: string, metadata: Record<string, unknown>) => Promise<NodeVO>;
  /**
   * Propose (or, with `write` access and `autoMerge` not explicitly `false`,
   * immediately apply) new content for a doc/whiteboard/workflow/html node —
   * the one write endpoint for every node type that owns exactly one document.
   * Replaces the old Doc-only `docs.updateBody` / `docs.createChangeRequest`
   * pair; whiteboard/workflow/html never had a reviewed write before this.
   */
  updateNodeContent: (
    nodeId: string,
    content: NodeContentInput,
    opts?: { message?: string; submittedBy?: string; autoMerge?: boolean },
  ) => Promise<ChangeRequestVO>;
  /**
   * Toggle the current actor's favorite on a node — a true upsert-or-delete
   * against the `(nodeId, actorId)` unique pair server-side. `favorited`
   * reflects the node's new state for the acting user.
   */
  toggleNodeFavorite: (nodeId: string) => Promise<{ favorited: boolean }>;
  /** The current actor's favorited nodes (see `nodes.listFavorites`). */
  listFavoriteNodes: () => Promise<NodeVO[]>;
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
  createReorderFieldsChangeRequest: (
    baseId: string,
    payload: {
      fieldIds: string[];
      message?: string;
      submittedBy?: string;
    },
  ) => Promise<ChangeRequestVO>;
  // `autoMerge` is typed `false`, not `boolean`, on purpose: these three facade
  // methods promise a plain ChangeRequestVO, and that promise is only honest on
  // the review-first branch of the endpoint's `materialized` union. Dashboard
  // callers pass an explicit `false` (their "propose for review" affordance must
  // queue a CR regardless of the actor's own permission) and then approve+merge
  // separately; a caller that actually wants the one-call auto-merge should use
  // the oRPC client's `views.changeRequest` directly and narrow the union.
  createViewChangeRequest: (
    baseId: string,
    payload: {
      config?: ViewConfigVO;
      description?: string;
      message?: string;
      name: string;
      slug: string;
      submittedBy?: string;
      type?: ViewType;
      autoMerge?: false;
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
      type?: ViewType;
      autoMerge?: false;
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
  ) => Promise<ChangeRequestReviewBatchResultVO>;
  mergeChangeRequestsMany: (changeRequestIds: string[]) => Promise<ChangeRequestMergeBatchResultVO>;
  reviseOperation: (
    operationId: string,
    payload: { fields: Record<string, unknown>; message?: string; author?: string },
  ) => Promise<ChangeRequestVO>;
  createChangeRequest: (
    baseId: string,
    payload: {
      fields: Record<string, unknown>;
      message?: string;
      submittedBy?: string;
      autoMerge?: boolean;
    },
  ) => Promise<ChangeRequestVO>;
  createUpdateChangeRequest: (
    recordId: string,
    payload: {
      fields: Record<string, unknown>;
      message?: string;
      author?: string;
      autoMerge?: boolean;
    },
  ) => Promise<RecordUpdateChangeRequestResult>;
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
    payload: { submittedBy?: string; message?: string; autoMerge?: false },
  ) => Promise<ChangeRequestVO>;
  createRestoreRecordChangeRequest: (
    recordId: string,
    payload: { submittedBy?: string; message?: string },
  ) => Promise<ChangeRequestVO>;
  /**
   * Dry-run "Install from GitHub" — the server fetches the repo, validates the
   * package and reports what it *would* create. Creates nothing. Space
   * owner/admin only (a package can carry skills and AirApps, i.e. code this
   * space's agents will execute), so a member gets a FORBIDDEN here.
   */
  planInstallFromGithub: (input: InstallPlanFromGithubDTO) => Promise<InstallPlanVO>;
  /** Performs the install planned by `planInstallFromGithub`. Same admin gate. */
  installFromGithub: (input: InstallFromGithubDTO) => Promise<InstallResultVO>;
  /**
   * The Template Center catalog. Unguarded — it lists public repositories and
   * says nothing about this workspace, so a member who cannot install can still
   * browse. The gate stays on the two install calls above.
   */
  listTemplates: (input?: ListTemplatesDTO) => Promise<TemplateCatalogVO>;
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
// contract-declared REST details are irrelevant here; every RPC call is POST.
export const createBusabaseORPCClient = (
  apiBasePath = "/api/rpc",
  opts?: {
    headers?:
      | Record<string, string>
      | (() => Record<string, string> | Promise<Record<string, string>>);
    /** Optional transport override for host-specific response handling. */
    fetch?: NonNullable<ConstructorParameters<typeof RPCLink>[0]["fetch"]>;
  },
): ContractRouterClient<BusabaseContract> => {
  const link = new RPCLink({
    url: resolveApiUrl(apiBasePath),
    headers: async () =>
      (typeof opts?.headers === "function" ? await opts.headers() : opts?.headers) ?? {},
    ...(opts?.fetch ? { fetch: opts.fetch } : {}),
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

/**
 * Narrows a discriminated `NodeDetailVO` back to the file-tree branch this
 * facade's `getSkill`/`getDrive` promise. The server already refuses a
 * mismatched `type`, so this only ever fires if the two drift apart — and when
 * it does it must be a clear error, never a silently mis-shaped object handed
 * to a caller that will read `.files` off it.
 */
const assertFileTreeDetail = <T extends "skill" | "drive">(
  detail: { type: string },
  expected: T,
  nodeIdOrSlug: string,
): Extract<NodeDetailVO, { type: T }> => {
  if (detail.type !== expected) {
    throw new Error(`Expected a ${expected} node, got "${detail.type}": ${nodeIdOrSlug}`);
  }
  return detail as Extract<NodeDetailVO, { type: T }>;
};

const batchItemError = (result: { error?: string; code?: string; data?: unknown } | undefined) =>
  Object.assign(new Error(result?.error ?? "Change request action returned no result"), {
    ...(result?.code ? { code: result.code } : {}),
    ...(result?.data === undefined ? {} : { data: result.data }),
  });

export const createBusabaseRestApiClient = (
  apiBasePath = "/api/v1",
  opts?: {
    headers?:
      | Record<string, string>
      | (() => Record<string, string> | Promise<Record<string, string>>);
    /** Optional transport override for host-specific response handling. */
    fetch?: NonNullable<ConstructorParameters<typeof RPCLink>[0]["fetch"]>;
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
    listArchivedNodes: () => client.nodes.list({ status: "archived" }),
    purgeNode: (nodeId) => client.nodes.purge({ nodeId }),
    moveNode: (payload) => client.nodes.move(payload),
    updateNodeMetadata: (nodeId, metadata) => client.nodes.updateMetadata({ nodeId, metadata }),
    updateNodeContent: (nodeId, content, opts) =>
      client.nodes.updateContent({ nodeId, content, ...opts }),
    toggleNodeFavorite: (nodeId) => client.nodes.toggleFavorite({ nodeId }),
    listFavoriteNodes: () => client.nodes.listFavorites(),
    // Reads through the unified Node detail route (`fileTrees.get` is retired).
    // The `type` hint both disambiguates a slug and narrows the discriminated
    // NodeDetailVO back to the file-tree shape this facade promises.
    getSkill: async (nodeIdOrSlug) => {
      const detail = await client.nodes.get({ nodeId: nodeIdOrSlug, type: "skill" });
      return assertFileTreeDetail(detail, "skill", nodeIdOrSlug);
    },
    readSkillFile: (nodeId, filePath) =>
      client.fileTrees.readFile({ nodeId, filePath, type: "skill" }),
    getDrive: async (nodeIdOrSlug) => {
      const detail = await client.nodes.get({ nodeId: nodeIdOrSlug, type: "drive" });
      return assertFileTreeDetail(detail, "drive", nodeIdOrSlug);
    },
    readDriveFile: (nodeId, filePath) =>
      client.fileTrees.readFile({ nodeId, filePath, type: "drive" }),
    listChangeRequests: async (options) =>
      (await client.changeRequests.list(options ?? {})).changeRequests,
    getChangeRequest: (changeRequestId) => client.changeRequests.get({ changeRequestId }),
    listRecords: async (options) => (await client.records.list(options ?? {})).records,
    getRecord: (recordId) => client.records.get({ recordId }),
    listRecordChangeRequests: (recordId) => client.records.listChangeRequests({ recordId }),
    searchRecords: (filter) => client.records.search(filter),
    listBases: () => client.bases.list({}),
    createBase: (payload) => client.bases.create(payload),
    createNodeChangeRequest: (payload) => client.nodes.createChangeRequest(payload),
    listViews: (baseId) => client.bases.listViews({ baseId, status: "active" }),
    createBaseField: (baseId, payload) => client.bases.createField({ baseId, ...payload }),
    createFieldChangeRequest: (baseId, payload) =>
      client.bases.fieldChangeRequest({ baseId, operation: "create", ...payload }),
    createUpdateFieldChangeRequest: (baseId, payload) =>
      client.bases.fieldChangeRequest({ baseId, operation: "update", ...payload }),
    createReorderFieldsChangeRequest: (baseId, payload) =>
      client.bases.fieldChangeRequest({ baseId, operation: "reorder", ...payload }),
    // `autoMerge: false` is pinned here (and on restore below), not merely
    // defaulted: the endpoint's permission-aware default would auto-merge for a
    // write-capable actor and hand back a materialized ViewVO, which is not what
    // this facade's `Promise<ChangeRequestVO>` signature — nor its dashboard
    // callers, which route the user to `/inbox/{cr.id}` — expect. A payload
    // `autoMerge` can only be `false`, so the spread cannot widen it back.
    // The cast narrows the endpoint's `materialized` union to the review-first
    // branch that the pinned flag guarantees at runtime.
    createViewChangeRequest: (baseId, payload) =>
      client.views.changeRequest({
        baseId,
        operation: "create",
        ...payload,
        autoMerge: false,
      }) as Promise<ChangeRequestVO>,
    createUpdateViewChangeRequest: (viewId, payload) =>
      client.views.changeRequest({
        viewId,
        operation: "update",
        ...payload,
        autoMerge: false,
      }) as Promise<ChangeRequestVO>,
    createDeleteViewChangeRequest: (viewId) =>
      client.views.changeRequest({
        viewId,
        operation: "delete",
        autoMerge: false,
      }) as Promise<ChangeRequestVO>,
    approveChangeRequest: async (changeRequestId, reason) => {
      const { results } = await client.changeRequests.review(
        reason
          ? { changeRequestIds: [changeRequestId], reason, verdict: "approved" }
          : { changeRequestIds: [changeRequestId], verdict: "approved" },
      );
      const result = results[0];
      if (!result?.ok) throw batchItemError(result);
      return result.changeRequest;
    },
    rejectChangeRequest: async (
      changeRequestId,
      reason = "Requested changes from Busabase dashboard",
    ) => {
      const { results } = await client.changeRequests.review({
        changeRequestIds: [changeRequestId],
        reason,
        verdict: "rejected",
      });
      const result = results[0];
      if (!result?.ok) throw batchItemError(result);
      return result.changeRequest;
    },
    closeChangeRequest: (changeRequestId, reason) =>
      client.changeRequests.close(reason ? { changeRequestId, reason } : { changeRequestId }),
    reviewChangeRequestsMany: (changeRequestIds, verdict, reason) =>
      client.changeRequests.review(
        reason ? { changeRequestIds, verdict, reason } : { changeRequestIds, verdict },
      ),
    mergeChangeRequestsMany: (changeRequestIds) =>
      client.changeRequests.merge({ changeRequestIds }),
    reviseOperation: (operationId, payload) =>
      client.operations.revise({ operationId, ...payload }),
    // This facade's payload never sets `autoMerge`, so the call always takes the
    // review-first branch of the endpoint's `materialized` union — narrow back
    // to the plain ChangeRequestVO this facade has always returned, rather than
    // pushing the (record-create-only) auto-merge union onto every dashboard
    // consumer of this interface.
    createChangeRequest: (baseId, payload) =>
      client.bases.createChangeRequest({ baseId, ...payload }) as Promise<ChangeRequestVO>,
    createUpdateChangeRequest: (recordId, payload) =>
      client.records.changeRequest({ recordId, operation: "update", ...payload }),
    createDeleteChangeRequest: async (recordId) => {
      const result = await client.records.changeRequest({
        recordId,
        operation: "delete",
        deleteMode: "archive",
      });
      if (result.materialized) {
        throw new Error("Record delete unexpectedly returned a materialized record");
      }
      return result;
    },
    mergeChangeRequest: async (changeRequestId) => {
      const { results } = await client.changeRequests.merge({
        changeRequestIds: [changeRequestId],
      });
      const result = results[0];
      if (!result?.ok) throw batchItemError(result);
      return {
        changeRequest: result.changeRequest,
        record: result.record,
        view: result.view,
      };
    },
    createAssetUploadUrl: (input) => client.assets.createUploadUrl(input),
    confirmAsset: (input) => client.assets.confirm(input),
    updateAssetMetadata: (input) => client.assets.updateMetadata(input),
    createRestoreBaseChangeRequest: (baseId, payload) =>
      client.bases.lifecycleChangeRequest({ baseId, operation: "restore", ...payload }),
    createRestoreFieldChangeRequest: (baseId, payload) =>
      client.bases.fieldChangeRequest({ baseId, operation: "restore", ...payload }),
    listArchivedViews: (baseId) => client.bases.listViews({ baseId, status: "archived" }),
    listArchivedRecords: async (baseId) =>
      (await client.records.list({ baseId, status: "archived" })).records,
    createRestoreViewChangeRequest: (viewId, payload) =>
      client.views.changeRequest({
        viewId,
        operation: "restore",
        ...payload,
        autoMerge: false,
      }) as Promise<ChangeRequestVO>,
    createRestoreRecordChangeRequest: async (recordId, payload) => {
      const result = await client.records.changeRequest({
        recordId,
        operation: "restore",
        ...payload,
      });
      if (result.materialized) {
        throw new Error("Record restore unexpectedly returned a materialized record");
      }
      return result;
    },
    planInstallFromGithub: (input) => client.install.planFromGithub(input),
    installFromGithub: (input) => client.install.fromGithub(input),
    listTemplates: (input) => client.templates.list(input ?? {}),
  };
};
