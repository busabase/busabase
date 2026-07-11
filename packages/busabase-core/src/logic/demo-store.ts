import "server-only";

import { ORPCError } from "@orpc/server";
import type { AuthInfo } from "busabase-contract/contract/schemas";
import type { AssetDetailVO, AssetUsageVO, AssetVO } from "busabase-contract/domains/assets/types";
import type { FolderVO } from "busabase-contract/domains/folder/types";
import type {
  AgentTaskVO,
  AuditEventVO,
  BaseVO,
  ChangeRequestStatus,
  ChangeRequestVO,
  CommentSubjectType,
  CommentVO,
  FileNodeVO,
  NodeVO,
  OperationKind,
  OperationVO,
  RecordVO,
  SearchResponseVO,
  SearchResultVO,
  ViewVO,
} from "busabase-contract/types";
import { iStringConcat } from "openlib/i18n/i-string";
import { getContextDemoLocale, getContextDemoUseCase } from "../context";
import {
  buildDemoDataset,
  DEMO_ACTOR_ID,
  type DemoDataset,
  type DemoDocVO,
  englishScenario,
} from "../demo/dataset";
import { zhCnScenario } from "../demo/scenarios/zh-cn";

// ─────────────────────────────────────────────────────────────────────────────
// Stateless demo read/write layer. Every function reads the shared seed
// (`demo/dataset.ts`) as VOs; writes return synthetic VOs and persist NOTHING,
// so a refresh resets the demo to the seeded state. Selected by the `?demo`
// router at the request boundary — never touches the db.
// ─────────────────────────────────────────────────────────────────────────────

const dataset = (): DemoDataset =>
  buildDemoDataset(
    getContextDemoUseCase(),
    new Date(),
    getContextDemoLocale() === "zh-CN" ? zhCnScenario : englishScenario,
  );

const nowIso = () => new Date().toISOString();
const demoId = (prefix: string) => `${prefix}_demo_${Date.now().toString(36)}`;

const notFound = (what: string, id: string) =>
  new ORPCError("NOT_FOUND", { message: `${what} not found in demo: ${id}` });

// ── Reads ────────────────────────────────────────────────────────────────────

export const demoListNodes = () => dataset().nodes;

// Folder nodes live one level under the synthetic root node; each already carries
// its base children, so a FolderVO is just { node, children }.
const demoFolderNodes = (): NodeVO[] => dataset().nodes[0]?.children ?? [];

export const demoListFolders = (): FolderVO[] =>
  demoFolderNodes().map((node) => ({ node, children: node.children ?? [] }));

export const demoGetFolder = (nodeIdOrSlug: string): FolderVO => {
  const node = demoFolderNodes().find(
    (folder) => folder.id === nodeIdOrSlug || folder.slug === nodeIdOrSlug,
  );
  if (!node) {
    throw notFound("Folder", nodeIdOrSlug);
  }
  return { node, children: node.children ?? [] };
};

export const demoListBases = () => dataset().bases;

export const demoGetBase = (baseId: string): BaseVO => {
  const base = dataset().bases.find((item) => item.id === baseId || item.slug === baseId);
  if (!base) {
    throw notFound("Base", baseId);
  }
  return base;
};

export const demoListViews = (baseId?: string): ViewVO[] => {
  const views = dataset().views;
  return baseId ? views.filter((view) => view.baseId === baseId) : views;
};

export const demoListRecords = (): RecordVO[] => dataset().records;

export const demoGetRecord = (recordId: string): RecordVO => {
  const record = dataset().records.find((item) => item.id === recordId);
  if (!record) {
    throw notFound("Record", recordId);
  }
  return record;
};

export const demoListRecordsByFieldText = (input: {
  baseId?: string;
  fieldSlug: string;
  valueText: string;
}): RecordVO[] => {
  const needle = input.valueText.toLowerCase();
  return dataset().records.filter((record) => {
    if (input.baseId && record.baseId !== input.baseId) {
      return false;
    }
    const value = record.headCommit.fields[input.fieldSlug];
    return typeof value === "string" && value.toLowerCase().includes(needle);
  });
};

export const demoListChangeRequests = (): ChangeRequestVO[] => dataset().changeRequests;

export const demoGetChangeRequest = (changeRequestId: string): ChangeRequestVO => {
  const changeRequest = dataset().changeRequests.find((item) => item.id === changeRequestId);
  if (!changeRequest) {
    throw notFound("ChangeRequest", changeRequestId);
  }
  return changeRequest;
};

export const demoListRecordChangeRequests = (recordId: string): ChangeRequestVO[] =>
  dataset().changeRequests.filter((changeRequest) =>
    changeRequest.operations.some(
      (operation) =>
        operation.targetRecordId === recordId ||
        operation.sourceRecordId === recordId ||
        operation.mergedRecordId === recordId,
    ),
  );

export const demoListAuditEvents = (): AuditEventVO[] => dataset().auditEvents;

export const demoListComments = (input: {
  subjectType: CommentSubjectType;
  subjectId: string;
}): CommentVO[] =>
  dataset().comments.filter(
    (comment) => comment.subjectType === input.subjectType && comment.subjectId === input.subjectId,
  );

export const demoListDocs = (): DemoDocVO[] => dataset().docs;

export const demoGetDoc = (nodeIdOrSlug: string): DemoDocVO => {
  const doc = dataset().docs.find(
    (item) => item.node.id === nodeIdOrSlug || item.node.slug === nodeIdOrSlug,
  );
  if (!doc) {
    throw notFound("Doc", nodeIdOrSlug);
  }
  return doc;
};

export const demoListFileNodes = (): FileNodeVO[] => dataset().files;

export const demoGetFileNode = (nodeIdOrSlug: string): FileNodeVO => {
  const file = dataset().files.find(
    (item) => item.node.id === nodeIdOrSlug || item.node.slug === nodeIdOrSlug,
  );
  if (!file) {
    throw notFound("File", nodeIdOrSlug);
  }
  return file;
};

// No agent tasks in the demo dataset; the review surface treats empty as "no
// agent work queued".

export const demoListAgentTasks = (): AgentTaskVO[] =>
  dataset()
    .changeRequests.filter((changeRequest) => changeRequest.status === "changes_requested")
    .map((changeRequest) => ({
      changeRequest,
      trigger: "changes_requested" as const,
      reviewReason: null,
      aiComments: [],
    }));

// Demo auth: a fixed demo identity (the seeded actor) owning the demo space.
export const demoGetAuthInfo = (): AuthInfo => ({
  space: { id: "demo", name: "Demo Workspace", slug: "demo", plan: "demo" },
  user: { id: DEMO_ACTOR_ID, name: "Demo User", email: null, image: null },
  member: { userId: DEMO_ACTOR_ID, spaceId: "demo", role: "owner" },
  spaces: [{ id: "demo", name: "Demo Workspace", slug: "demo", plan: "demo" }],
});

// --- Assets (derived from the seed's attachment field values) ---------------
// The demo has no DB, so the Asset library + Where-Used are computed on the fly:
// scan every seeded record's attachment-type fields, dedup by attachmentId, and
// treat each referencing record as a usage. Asset id == attachmentId in demo mode.

interface DemoAssetRef {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
}

const extractDemoRefs = (value: unknown): DemoAssetRef[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const refs: DemoAssetRef[] = [];
  for (const item of value) {
    if (item && typeof item === "object") {
      const r = item as Record<string, unknown>;
      const id =
        typeof r.attachmentId === "string"
          ? r.attachmentId
          : typeof r.id === "string"
            ? r.id
            : null;
      if (id) {
        refs.push({
          attachmentId: id,
          fileName: typeof r.fileName === "string" ? r.fileName : id,
          mimeType: typeof r.mimeType === "string" ? r.mimeType : "application/octet-stream",
          size: typeof r.size === "number" ? r.size : 0,
          url: typeof r.url === "string" ? r.url : "",
        });
      }
    }
  }
  return refs;
};

const buildDemoAssetIndex = (): {
  assets: Map<string, AssetVO>;
  usages: Map<string, AssetUsageVO[]>;
} => {
  const data = dataset();
  const epoch = new Date(0).toISOString();
  const assets = new Map<string, AssetVO>();
  const usages = new Map<string, AssetUsageVO[]>();

  for (const record of data.records) {
    const base = record.base;
    if (!base) {
      continue;
    }
    const attachmentSlugs = base.fields
      .filter((field) => field.type === "attachment")
      .map((field) => field.slug);
    for (const slug of attachmentSlugs) {
      for (const ref of extractDemoRefs(record.headCommit.fields[slug])) {
        if (!assets.has(ref.attachmentId)) {
          assets.set(ref.attachmentId, {
            id: ref.attachmentId,
            attachmentId: ref.attachmentId,
            name: ref.fileName,
            contentKind: "binary",
            metadata: {},
            fileName: ref.fileName,
            mimeType: ref.mimeType,
            size: ref.size,
            url: ref.url,
            contentHash: null,
            usageCount: 0,
            // Decorative demo-only binary refs — no text supplied.
            textStatus: "missing",
            createdAt: epoch,
          });
        }
        const list = usages.get(ref.attachmentId) ?? [];
        list.push({
          ownerType: "base",
          nodeId: base.nodeId ?? base.id,
          nodeName: base.name,
          nodeType: "base",
          nodeSlug: base.slug,
          path: null,
          recordId: record.id,
          fieldSlug: slug,
          blockId: null,
          createdAt: epoch,
        });
        usages.set(ref.attachmentId, list);
      }
    }
  }
  for (const [id, asset] of assets) {
    asset.usageCount = (usages.get(id) ?? []).length;
  }
  return { assets, usages };
};

export const demoListAssets = (): AssetVO[] => [...buildDemoAssetIndex().assets.values()];

export const demoGetAsset = (assetId: string): AssetDetailVO => {
  const { assets, usages } = buildDemoAssetIndex();
  const asset = assets.get(assetId);
  if (!asset) {
    throw notFound("Asset", assetId);
  }
  return { asset, usages: usages.get(assetId) ?? [] };
};

const toSearchText = (fields: Record<string, unknown>) =>
  Object.values(fields)
    .map((value) =>
      typeof value === "string" ? value : Array.isArray(value) ? value.join(" ") : "",
    )
    .join(" ");

export const demoSearch = (input: {
  query: string;
  limit?: number;
  offset?: number;
}): SearchResponseVO => {
  const query = (input.query ?? "").trim();
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;
  const data = dataset();
  const needle = query.toLowerCase();
  const match = (haystack: string) => needle === "" || haystack.toLowerCase().includes(needle);

  const recordResults: SearchResultVO[] = data.records
    .filter((record) => match(`${toSearchText(record.headCommit.fields)}`))
    .map((record) => ({
      id: record.id,
      kind: "record",
      // Title = base's primary (first) field value — same convention as store.ts.
      title: String(record.headCommit.fields[record.base.fields[0]?.slug ?? ""] ?? "") || record.id,
      body: String(record.headCommit.fields.body ?? record.headCommit.fields.description ?? ""),
      eyebrow: `${record.base.name} · canonical record`,
      href: `/base/${record.base.slug}/${record.id}`,
      updatedAt: record.updatedAt,
    }));

  const changeRequestResults: SearchResultVO[] = data.changeRequests
    .filter((changeRequest) =>
      match(
        changeRequest.operations
          .map((operation) => toSearchText(operation.headCommit.fields))
          .join(" "),
      ),
    )
    .map((changeRequest) => ({
      id: changeRequest.id,
      kind: "change_request",
      title:
        changeRequest.operationCount > 1
          ? `${changeRequest.operationCount} operation changeRequest`
          : String(
              changeRequest.primaryOperation?.headCommit.fields.title ??
                changeRequest.primaryOperation?.headCommit.fields.name ??
                changeRequest.id,
            ),
      body: changeRequest.operations
        .map((operation) => toSearchText(operation.headCommit.fields))
        .join(" "),
      eyebrow: `${changeRequest.base?.name ?? "Node tree"} · ${changeRequest.status}`,
      href: `/inbox/${changeRequest.id}`,
      updatedAt: changeRequest.updatedAt,
    }));

  const baseResults: SearchResultVO[] = data.bases
    .filter((base) => match(`${base.name} ${base.description} ${base.slug}`))
    .map((base) => ({
      id: base.id,
      kind: "base",
      title: base.name,
      body: `${base.description} ${base.fields.map((field) => `${iStringConcat(field.name)} ${field.slug}`).join(" ")}`,
      eyebrow: `${base.fields.length} fields · ${base.slug}`,
      href: `/base/${base.slug}`,
      updatedAt: base.createdAt,
    }));

  const results = [...recordResults, ...changeRequestResults, ...baseResults].slice(
    offset,
    offset + limit,
  );
  return {
    hasMore:
      recordResults.length + changeRequestResults.length + baseResults.length > offset + limit,
    limit,
    offset,
    query,
    results,
  };
};

// ── Synthetic writes (no persistence) ─────────────────────────────────────────

const synthOperation = (
  changeRequestId: string,
  baseId: string,
  operation: OperationKind,
  fields: Record<string, unknown>,
  options: Partial<OperationVO> = {},
): OperationVO => {
  const createdAt = nowIso();
  const commitId = demoId("qcm");
  return {
    id: demoId("qop"),
    changeRequestId,
    baseId,
    targetType: "base",
    nodeId: null,
    operation,
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    filePath: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt,
    updatedAt: createdAt,
    headCommit: {
      id: commitId,
      baseId,
      targetType: "base",
      nodeId: null,
      operationId: null,
      parentCommitId: null,
      fields,
      operation,
      message: "Demo change",
      author: DEMO_ACTOR_ID,
      createdAt,
    },
    baseFields: null,
    ...options,
  };
};

const synthChangeRequest = (
  baseId: string,
  status: ChangeRequestStatus,
  operations: OperationVO[],
  sourceMeta: Record<string, unknown> = { demo: true },
): ChangeRequestVO => {
  const createdAt = nowIso();
  const base = dataset().bases.find((item) => item.id === baseId) ?? null;
  return {
    id: demoId("qdf"),
    baseId,
    targetType: "base",
    nodeId: null,
    status,
    submittedBy: DEMO_ACTOR_ID,
    sourceMeta,
    reviewPolicySnapshot: { kind: "single", requiredApprovals: 1 },
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt,
    updatedAt: createdAt,
    base,
    node: null,
    operations,
    primaryOperation: operations[0] ?? null,
    operationCount: operations.length,
    reviews: [],
  };
};

export const demoReviewChangeRequest = (
  changeRequestId: string,
  payload: { verdict: "approved" | "rejected"; reason?: string },
): ChangeRequestVO => {
  const changeRequest = demoGetChangeRequest(changeRequestId);
  const status: ChangeRequestStatus =
    payload.verdict === "approved" ? "approved" : "changes_requested";
  const reviewedAt = nowIso();
  return {
    ...changeRequest,
    status,
    reviewedAt,
    updatedAt: reviewedAt,
    rejectedReason: payload.verdict === "rejected" ? (payload.reason ?? null) : null,
    reviews: [
      ...changeRequest.reviews,
      {
        id: demoId("qrv"),
        changeRequestId,
        reviewerId: DEMO_ACTOR_ID,
        verdict: payload.verdict,
        reason: payload.reason ?? null,
        visibleOperationHeads: Object.fromEntries(
          changeRequest.operations.map((operation) => [operation.id, operation.headCommitId]),
        ),
        createdAt: reviewedAt,
      },
    ],
  };
};

export const demoCloseChangeRequest = (
  changeRequestId: string,
  reason?: string,
): ChangeRequestVO => {
  const changeRequest = demoGetChangeRequest(changeRequestId);
  const updatedAt = nowIso();
  return {
    ...changeRequest,
    status: "abandoned",
    rejectedReason: reason ?? null,
    updatedAt,
  };
};

export const demoMergeChangeRequest = (
  changeRequestId: string,
): { changeRequest: ChangeRequestVO; record: RecordVO | null; view: ViewVO | null } => {
  const changeRequest = demoGetChangeRequest(changeRequestId);
  const mergedAt = nowIso();
  const mergedChangeRequest: ChangeRequestVO = {
    ...changeRequest,
    status: "merged",
    mergedAt,
    updatedAt: mergedAt,
  };
  const primary = changeRequest.primaryOperation;
  const base = changeRequest.base;
  // Surface a plausible canonical record so the UI can land on lineage; reset
  // on refresh because nothing persisted.
  const record: RecordVO | null =
    primary && base && primary.operation !== "view_update" && primary.operation !== "view_delete"
      ? {
          id: primary.targetRecordId ?? demoId("qrc"),
          baseId: base.id,
          headCommitId: primary.headCommitId,
          parentRecordId: null,
          parentCommitId: null,
          status: primary.operation === "record_delete" ? "archived" : "active",
          createdBy: DEMO_ACTOR_ID,
          archivedAt: primary.operation === "record_delete" ? mergedAt : null,
          createdAt: changeRequest.createdAt,
          updatedAt: mergedAt,
          base,
          headCommit: primary.headCommit,
        }
      : null;
  return { changeRequest: mergedChangeRequest, record, view: null };
};

export const demoCreateChangeRequest = (
  baseId: string,
  payload: { fields: Record<string, unknown>; submittedBy?: string },
): ChangeRequestVO =>
  synthChangeRequest(baseId, "in_review", [
    synthOperation(demoId("qdf"), baseId, "record_create", payload.fields),
  ]);

export const demoCreateDeleteChangeRequest = (recordId: string): ChangeRequestVO => {
  const record = demoGetRecord(recordId);
  return synthChangeRequest(record.baseId, "in_review", [
    synthOperation(demoId("qdf"), record.baseId, "record_delete", record.headCommit.fields, {
      targetRecordId: recordId,
      baseFields: record.headCommit.fields,
    }),
  ]);
};

export const demoCreateUpdateChangeRequest = (
  recordId: string,
  payload: { fields: Record<string, unknown> },
): ChangeRequestVO => {
  const record = demoGetRecord(recordId);
  return synthChangeRequest(record.baseId, "in_review", [
    synthOperation(demoId("qdf"), record.baseId, "record_update", payload.fields, {
      targetRecordId: recordId,
      baseFields: record.headCommit.fields,
    }),
  ]);
};

export const demoReviseOperation = (operationId: string): ChangeRequestVO => {
  const changeRequest = dataset().changeRequests.find((item) =>
    item.operations.some((operation) => operation.id === operationId),
  );
  if (!changeRequest) {
    throw notFound("Operation", operationId);
  }
  return { ...changeRequest, status: "in_review", updatedAt: nowIso() };
};

export const demoCreateAuditEvent = (input: {
  action: AuditEventVO["action"];
  actorId?: string;
  baseId?: string | null;
  recordId?: string | null;
  changeRequestId?: string | null;
  operationId?: string | null;
  commitId?: string | null;
  metadata?: Record<string, unknown>;
}): AuditEventVO => ({
  id: demoId("qae"),
  action: input.action,
  actorId: input.actorId ?? "local-viewer",
  baseId: input.baseId ?? null,
  recordId: input.recordId ?? null,
  changeRequestId: input.changeRequestId ?? null,
  operationId: input.operationId ?? null,
  commitId: input.commitId ?? null,
  metadata: input.metadata ?? {},
  createdAt: nowIso(),
});

export const demoCreateComment = (input: {
  subjectType: CommentVO["subjectType"];
  subjectId: string;
  authorId?: string;
  body: string;
  mentionsAi?: boolean;
}): CommentVO => {
  const createdAt = nowIso();
  return {
    id: demoId("qcomment"),
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    recordId: input.subjectType === "record" ? input.subjectId : null,
    changeRequestId: input.subjectType === "change_request" ? input.subjectId : null,
    operationId: input.subjectType === "operation" ? input.subjectId : null,
    commitId: input.subjectType === "commit" ? input.subjectId : null,
    authorId: input.authorId ?? DEMO_ACTOR_ID,
    body: input.body,
    mentionsAi: input.mentionsAi ?? false,
    createdAt,
    updatedAt: createdAt,
  };
};
