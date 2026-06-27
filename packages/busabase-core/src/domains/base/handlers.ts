import "server-only";

import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNotNull, max, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId } from "../../context";
import { getDb } from "../../db";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseChangeRequests,
  busabaseCommits,
  busabaseFieldValues,
  busabaseNodes,
  busabaseOperations,
  busabaseRecordLinks,
  busabaseRecords,
  busabaseViews,
  type CommitPO,
  type OperationPO,
  type RecordPO,
} from "../../db/schema";
import { CURRENT_USER_ID, id, now, requireBaseId, rootNodeIdForSpace } from "../../logic/kernel";
import { type MaterializeArgs, registerMaterializer } from "../../logic/materialize";
import {
  createBaseInputSchema,
  createChangeRequestInputSchema,
  createDeleteChangeRequestInputSchema,
  createViewInputSchema,
  deleteViewInputSchema,
  ensureReady,
  fieldSchema,
  getChangeRequest,
  hydrateRecord,
  insertAuditEvent,
  listInputSchema,
  type MergeCtx,
  normalizeViewConfig,
  projectCommitFields,
  recordFieldFilterInputSchema,
  reviseOperationInputSchema,
  toBaseVO,
  toRecordLinkVO,
  toViewVO,
  updateViewInputSchema,
} from "../../logic/store";
import type { ViewConfigVO } from "../../types";
import { removeRecordAssetUsages, syncRecordAssetUsages } from "../assets/handlers";
import { createFieldChangeRequestInputSchema } from "./contract/base-schemas";
import { computeSystemFieldValues, validateRecordFields } from "./field-rules";
import { type FieldDef, isSystemFieldType } from "./field-types";
import type { BaseFieldPO } from "./schema";

export const listBases = async () => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const baseRows = await db
    .select()
    .from(busabaseBases)
    .where(eq(busabaseBases.spaceId, spaceId))
    .orderBy(asc(busabaseBases.createdAt));
  const fieldRows = await db
    .select()
    .from(busabaseBaseFields)
    .where(eq(busabaseBaseFields.spaceId, spaceId))
    .orderBy(asc(busabaseBaseFields.position));
  return baseRows.map((base) =>
    toBaseVO(
      base,
      fieldRows.filter((field) => field.baseId === base.id),
    ),
  );
};

export const getBase = async (baseId: string) => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [base] = await db
    .select()
    .from(busabaseBases)
    .where(and(eq(busabaseBases.slug, baseId), eq(busabaseBases.spaceId, spaceId)))
    .limit(1);
  const [baseById] = base
    ? [base]
    : await db
        .select()
        .from(busabaseBases)
        .where(and(eq(busabaseBases.id, baseId), eq(busabaseBases.spaceId, spaceId)))
        .limit(1);
  if (!baseById) {
    return null;
  }
  const fields = await db
    .select()
    .from(busabaseBaseFields)
    .where(eq(busabaseBaseFields.baseId, baseById.id))
    .orderBy(asc(busabaseBaseFields.position));
  return toBaseVO(baseById, fields);
};

export const listViews = async (baseId?: string) => {
  await ensureReady();
  const db = await getDb();
  const resolvedBase = baseId ? await getBase(baseId) : null;
  const viewRows = resolvedBase
    ? await db
        .select()
        .from(busabaseViews)
        .where(and(eq(busabaseViews.baseId, resolvedBase.id), eq(busabaseViews.status, "active")))
        .orderBy(asc(busabaseViews.createdAt))
    : await db
        .select()
        .from(busabaseViews)
        .where(
          and(eq(busabaseViews.spaceId, getContextSpaceId()), eq(busabaseViews.status, "active")),
        )
        .orderBy(asc(busabaseViews.createdAt));
  return viewRows.map(toViewVO);
};

export const createBase = async (input: z.infer<typeof createBaseInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = createBaseInputSchema.parse(input);
  const existing = await getBase(parsed.slug);
  if (existing) {
    return existing;
  }

  const parentNodeId = parsed.parentNodeId ?? rootNodeIdForSpace(getContextSpaceId());
  const [parentNode] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, parentNodeId))
    .limit(1);
  if (!parentNode || parentNode.type !== "folder") {
    throw new Error(`Parent folder not found: ${parentNodeId}`);
  }

  const baseId = id("bse");
  const nodeId = id("nod");
  const createdAt = now();
  await db.insert(busabaseNodes).values({
    id: nodeId,
    parentId: parentNode.id,
    type: "base",
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    position: 0,
    createdAt,
    updatedAt: createdAt,
  });

  await db.insert(busabaseBases).values({
    id: baseId,
    nodeId,
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    reviewPolicy: { kind: "single", requiredApprovals: 1 },
    createdAt,
  });
  await db.insert(busabaseBaseFields).values(
    parsed.fields.map((field, index) => ({
      id: id("bsf"),
      baseId,
      slug: field.slug,
      name: field.name,
      type: field.type,
      required: field.required,
      position: index,
      options: field.options,
    })),
  );

  const base = await getBase(baseId);
  if (!base) {
    throw new Error("Failed to create base");
  }
  return base;
};

export const createBaseField = async (baseId: string, input: z.infer<typeof fieldSchema>) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }
  const parsed = fieldSchema.parse(input);
  if (parsed.type === "relation" && !parsed.options.targetBaseId) {
    throw new Error("Relation field requires a target Base");
  }
  const [existing] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, base.id), eq(busabaseBaseFields.slug, parsed.slug)))
    .limit(1);
  if (existing) {
    throw new Error(`Field already exists: ${parsed.slug}`);
  }
  const fieldCount = base.fields.length;
  await db.insert(busabaseBaseFields).values({
    id: id("bsf"),
    baseId: base.id,
    slug: parsed.slug,
    name: parsed.name,
    type: parsed.type,
    required: parsed.required,
    position: fieldCount,
    options: parsed.options,
  });
  const updatedBase = await getBase(base.id);
  if (!updatedBase) {
    throw new Error("Failed to create field");
  }
  return updatedBase;
};

export const createFieldChangeRequest = async (
  baseId: string,
  input: z.input<typeof createFieldChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }

  const parsed = createFieldChangeRequestInputSchema.parse(input);
  if (parsed.type === "relation" && !parsed.options.targetBaseId) {
    throw new Error("Relation field requires a target Base");
  }
  const [existing] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, base.id), eq(busabaseBaseFields.slug, parsed.slug)))
    .limit(1);
  if (existing) {
    throw new Error(`Field already exists: ${parsed.slug}`);
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const fields = {
    name: parsed.name,
    slug: parsed.slug,
    type: parsed.type,
    required: parsed.required,
    options: parsed.options,
  };

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "base_add_field",
    message: parsed.message,
    author: parsed.submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: base.id,
    status: "in_review",
    submittedBy: resolveActorId(parsed.submittedBy),
    sourceMeta: { subject: "base_field", fieldSlug: parsed.slug },
    reviewPolicySnapshot: base.reviewPolicy,
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: base.id,
    operation: "base_add_field",
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: parsed.submittedBy,
    baseId: base.id,
    changeRequestId,
    commitId,
    operationId,
    metadata: { operation: "base_add_field", fieldSlug: parsed.slug },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create field change request");
  }
  return changeRequest;
};

export const createViewChangeRequest = async (
  baseId: string,
  input: z.input<typeof createViewInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }

  const parsed = createViewInputSchema.parse(input);
  const existingViews = await listViews(base.id);
  if (existingViews.some((view) => view.slug === parsed.slug)) {
    throw new Error(`View slug already exists: ${parsed.slug}`);
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const fields = {
    config: parsed.config,
    description: parsed.description,
    name: parsed.name,
    slug: parsed.slug,
  };

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "view_create",
    message: parsed.message,
    author: parsed.submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: base.id,
    status: "in_review",
    submittedBy: resolveActorId(parsed.submittedBy),
    sourceMeta: { subject: "view", viewSlug: parsed.slug },
    reviewPolicySnapshot: base.reviewPolicy,
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: base.id,
    operation: "view_create",
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: parsed.submittedBy,
    baseId: base.id,
    changeRequestId,
    commitId,
    operationId,
    metadata: { operation: "view_create", viewSlug: parsed.slug },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create view change request");
  }
  return changeRequest;
};

export const createUpdateViewChangeRequest = async (
  viewId: string,
  input: z.input<typeof updateViewInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const [view] = await db.select().from(busabaseViews).where(eq(busabaseViews.id, viewId)).limit(1);
  if (!view || view.status !== "active") {
    throw new Error(`View not found: ${viewId}`);
  }
  const base = await getBase(view.baseId);
  if (!base) {
    throw new Error(`Base not found: ${view.baseId}`);
  }

  const parsed = updateViewInputSchema.parse(input);
  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const fields = {
    config: parsed.config ?? normalizeViewConfig(view.config),
    description: parsed.description ?? view.description,
    name: parsed.name ?? view.name,
  };

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: view.baseId,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "view_update",
    message: parsed.message,
    author: parsed.submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: view.baseId,
    status: "in_review",
    submittedBy: resolveActorId(parsed.submittedBy),
    sourceMeta: { subject: "view", viewId: view.id },
    reviewPolicySnapshot: base.reviewPolicy,
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: view.baseId,
    operation: "view_update",
    status: "pending",
    targetRecordId: null,
    targetViewId: view.id,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  await insertAuditEvent(db, {
    action: "change_request.updated",
    actorId: parsed.submittedBy,
    baseId: view.baseId,
    changeRequestId,
    commitId,
    operationId,
    metadata: { operation: "view_update", viewId: view.id },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create view update change request");
  }
  return changeRequest;
};

export const createDeleteViewChangeRequest = async (
  viewId: string,
  input?: z.input<typeof deleteViewInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const [view] = await db.select().from(busabaseViews).where(eq(busabaseViews.id, viewId)).limit(1);
  if (!view || view.status !== "active") {
    throw new Error(`View not found: ${viewId}`);
  }
  const base = await getBase(view.baseId);
  if (!base) {
    throw new Error(`Base not found: ${view.baseId}`);
  }

  const parsed = deleteViewInputSchema.parse(input);
  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const fields = {
    config: normalizeViewConfig(view.config),
    description: view.description,
    name: view.name,
    slug: view.slug,
  };

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: view.baseId,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "view_delete",
    message: parsed.message,
    author: parsed.submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: view.baseId,
    status: "in_review",
    submittedBy: resolveActorId(parsed.submittedBy),
    sourceMeta: { subject: "view", viewId: view.id },
    reviewPolicySnapshot: base.reviewPolicy,
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: view.baseId,
    operation: "view_delete",
    status: "pending",
    targetRecordId: null,
    targetViewId: view.id,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  await insertAuditEvent(db, {
    action: "change_request.deleted",
    actorId: parsed.submittedBy,
    baseId: view.baseId,
    changeRequestId,
    commitId,
    operationId,
    metadata: { operation: "view_delete", viewId: view.id },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create view delete change request");
  }
  return changeRequest;
};

export const createChangeRequest = async (
  baseId: string,
  input: z.infer<typeof createChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }

  const parsed = createChangeRequestInputSchema.parse(input);
  assertValidRecordFields(parsed.fields, base.fields);
  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    fields: parsed.fields,
    operation: "record_create",
    message: parsed.message,
    author: "producer",
    createdAt: timestamp,
  });

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: base.id,
    status: "in_review",
    submittedBy: resolveActorId(parsed.submittedBy),
    sourceMeta: {},
    reviewPolicySnapshot: base.reviewPolicy,
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: base.id,
    operation: "record_create",
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));

  await projectCommitFields({
    baseId: base.id,
    commitId,
    changeRequestId,
    operationId,
    fields: parsed.fields,
  });
  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: parsed.submittedBy,
    baseId: base.id,
    changeRequestId,
    operationId,
    commitId,
    metadata: { operation: "record_create" },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create changeRequest");
  }
  return changeRequest;
};

export const createDeleteChangeRequest = async (
  recordId: string,
  input: z.infer<typeof createDeleteChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = createDeleteChangeRequestInputSchema.parse(input);
  const [record] = await db
    .select()
    .from(busabaseRecords)
    .where(eq(busabaseRecords.id, recordId))
    .limit(1);
  if (!record) {
    throw new Error(`Record not found: ${recordId}`);
  }
  if (record.status === "archived") {
    throw new Error(`Record is already archived: ${recordId}`);
  }

  const [headCommit] = await db
    .select()
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, record.headCommitId))
    .limit(1);
  if (!headCommit) {
    throw new Error(`Record head commit not found: ${record.headCommitId}`);
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: record.baseId,
    operationId: null,
    parentCommitId: record.headCommitId,
    fields: headCommit.fields,
    operation: "record_delete",
    message: parsed.message,
    author: "producer",
    createdAt: timestamp,
  });

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: record.baseId,
    status: "in_review",
    submittedBy: resolveActorId(parsed.submittedBy),
    sourceMeta: {},
    reviewPolicySnapshot: {},
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: record.baseId,
    operation: "record_delete",
    status: "pending",
    targetRecordId: record.id,
    targetViewId: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: record.headCommitId,
    headCommitId: commitId,
    deleteMode: parsed.deleteMode,
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  await projectCommitFields({
    baseId: record.baseId,
    commitId,
    changeRequestId,
    operationId,
    fields: headCommit.fields,
  });
  await insertAuditEvent(db, {
    action: "change_request.deleted",
    actorId: parsed.submittedBy,
    baseId: record.baseId,
    recordId: record.id,
    changeRequestId,
    operationId,
    commitId,
    metadata: { deleteMode: parsed.deleteMode, operation: "record_delete" },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create delete changeRequest");
  }
  return changeRequest;
};

export const createUpdateChangeRequest = async (
  recordId: string,
  input: z.infer<typeof reviseOperationInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = reviseOperationInputSchema.parse(input);
  const [record] = await db
    .select()
    .from(busabaseRecords)
    .where(eq(busabaseRecords.id, recordId))
    .limit(1);
  if (!record) {
    throw new Error(`Record not found: ${recordId}`);
  }
  if (record.status === "archived") {
    throw new Error(`Record is already archived: ${recordId}`);
  }

  const base = await getBase(record.baseId);
  if (!base) {
    throw new Error(`Base not found: ${record.baseId}`);
  }
  assertValidRecordFields(parsed.fields, base.fields);

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: record.baseId,
    operationId: null,
    parentCommitId: record.headCommitId,
    fields: parsed.fields,
    operation: "record_update",
    message: parsed.message,
    author: parsed.author,
    createdAt: timestamp,
  });

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: record.baseId,
    status: "in_review",
    submittedBy: resolveActorId(parsed.author),
    sourceMeta: {},
    reviewPolicySnapshot: base.reviewPolicy,
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: record.baseId,
    operation: "record_update",
    status: "pending",
    targetRecordId: record.id,
    targetViewId: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: record.headCommitId,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  await projectCommitFields({
    baseId: record.baseId,
    commitId,
    changeRequestId,
    operationId,
    fields: parsed.fields,
  });
  await insertAuditEvent(db, {
    action: "change_request.updated",
    actorId: parsed.author,
    baseId: record.baseId,
    recordId: record.id,
    changeRequestId,
    operationId,
    commitId,
    metadata: { operation: "record_update" },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create update changeRequest");
  }
  return changeRequest;
};

export const listRecords = async (input?: z.input<typeof listInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = listInputSchema.parse(input);
  const recordRows = await db
    .select()
    .from(busabaseRecords)
    .where(
      and(eq(busabaseRecords.spaceId, getContextSpaceId()), eq(busabaseRecords.status, "active")),
    )
    .orderBy(desc(busabaseRecords.createdAt))
    .limit(parsed.limit);
  return Promise.all(recordRows.map(hydrateRecord));
};

export const getRecord = async (recordId: string) => {
  await ensureReady();
  const db = await getDb();
  const [record] = await db
    .select()
    .from(busabaseRecords)
    .where(and(eq(busabaseRecords.id, recordId), eq(busabaseRecords.spaceId, getContextSpaceId())))
    .limit(1);
  return record ? hydrateRecord(record) : null;
};

export const listRecordLinks = async (recordId: string) => {
  await ensureReady();
  const db = await getDb();
  const links = await db
    .select()
    .from(busabaseRecordLinks)
    .where(
      and(
        eq(busabaseRecordLinks.spaceId, getContextSpaceId()),
        eq(busabaseRecordLinks.sourceRecordId, recordId),
      ),
    )
    .orderBy(asc(busabaseRecordLinks.position), asc(busabaseRecordLinks.createdAt));
  return links.map(toRecordLinkVO);
};

export const listRecordsByFieldText = async (
  input: z.input<typeof recordFieldFilterInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = recordFieldFilterInputSchema.parse(input);
  const filters: SQL[] = [
    eq(busabaseFieldValues.spaceId, getContextSpaceId()),
    eq(busabaseFieldValues.fieldSlug, parsed.fieldSlug),
    eq(busabaseFieldValues.valueText, parsed.valueText),
    isNotNull(busabaseFieldValues.recordId),
  ];
  if (parsed.baseId) {
    filters.push(eq(busabaseFieldValues.baseId, parsed.baseId));
  }

  const projectionRows = await db
    .select()
    .from(busabaseFieldValues)
    .where(and(...filters))
    .orderBy(desc(busabaseFieldValues.createdAt))
    .limit(parsed.limit);
  const recordIds = projectionRows
    .map((row) => row.recordId)
    .filter((recordId): recordId is string => Boolean(recordId));

  if (recordIds.length === 0) {
    return [];
  }

  const recordRows = await db
    .select()
    .from(busabaseRecords)
    .where(and(inArray(busabaseRecords.id, recordIds), eq(busabaseRecords.status, "active")));
  const recordsById = new Map(recordRows.map((record) => [record.id, record]));
  return Promise.all(
    recordIds
      .map((recordId) => recordsById.get(recordId))
      .filter((record): record is RecordPO => Boolean(record))
      .map(hydrateRecord),
  );
};

// --- field rules glue: validation on submit, computed values on merge -------

/** Reject a change request whose field values violate their field-type rules. */
const assertValidRecordFields = (
  fields: Record<string, unknown>,
  defs: ReadonlyArray<FieldDef>,
) => {
  const errors = validateRecordFields(fields, defs);
  if (errors.length > 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Invalid field value${errors.length === 1 ? "" : "s"}: ${errors
        .map((error) => error.message)
        .join("; ")}`,
      data: { errors },
    });
  }
};

const loadBaseFieldDefs = (db: MergeCtx["db"], baseId: string): Promise<BaseFieldPO[]> =>
  db.select().from(busabaseBaseFields).where(eq(busabaseBaseFields.baseId, baseId));

/** Next per-base sequential value for an auto_number field (max stored + 1). */
const nextAutoNumber = async (
  db: MergeCtx["db"],
  baseId: string,
  field: BaseFieldPO,
): Promise<number> => {
  const [row] = await db
    .select({ value: max(busabaseFieldValues.valueNumber) })
    .from(busabaseFieldValues)
    .where(and(eq(busabaseFieldValues.baseId, baseId), eq(busabaseFieldValues.fieldId, field.id)));
  return Math.floor(Number(row?.value ?? 0)) + 1;
};

/**
 * Strip client-supplied system fields and overlay server-computed values
 * (created_/updated_ stamps, auto_number) onto the record's fields at merge time.
 */
const applyComputedRecordFields = async (
  ctx: MergeCtx,
  args: {
    baseId: string;
    mode: "create" | "update";
    fields: Record<string, unknown>;
    existing?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> => {
  const defs = await loadBaseFieldDefs(ctx.db, args.baseId);
  const autoNumbers = new Map<string, number>();
  if (args.mode === "create") {
    for (const def of defs) {
      if (def.type === "auto_number") {
        autoNumbers.set(def.slug, await nextAutoNumber(ctx.db, args.baseId, def));
      }
    }
  }
  const overrides = computeSystemFieldValues({
    defs,
    mode: args.mode,
    actorId: ctx.actorId,
    timestampIso: ctx.timestamp.toISOString(),
    existing: args.existing,
    nextAutoNumber: (def) => autoNumbers.get(def.slug) ?? 1,
  });
  // System fields are never client-settable; drop any then apply computed values.
  const userFields = { ...args.fields };
  for (const def of defs) {
    if (isSystemFieldType(def.type)) delete userFields[def.slug];
  }
  return { ...userFields, ...overrides };
};

// --- base domain: record + view merge handlers ------------------------------
export const mergeRecordCreate = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const baseId = requireBaseId(item.baseId, item.operation);
  const recordId = id("rec");
  await db.insert(busabaseRecords).values({
    id: recordId,
    baseId,
    headCommitId: item.headCommitId,
    parentRecordId: item.sourceRecordId,
    parentCommitId: item.sourceCommitId,
    status: "active",
    createdBy: resolveActorId(CURRENT_USER_ID),
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  // Stamp created_/updated_ + assign auto_number, then persist into the commit
  // (the read source of truth) before projecting the field values.
  const fields = await applyComputedRecordFields(ctx, {
    baseId,
    mode: "create",
    fields: headCommit.fields,
  });
  await db.update(busabaseCommits).set({ fields }).where(eq(busabaseCommits.id, item.headCommitId));
  await projectCommitFields({
    baseId,
    commitId: item.headCommitId,
    recordId,
    fields,
  });
  await syncRecordAssetUsages(baseId, recordId, headCommit.fields);
  await db
    .update(busabaseOperations)
    .set({ status: "merged", mergedRecordId: recordId, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedRecordIds.push(recordId);
};

export const mergeViewCreate = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const baseId = requireBaseId(item.baseId, item.operation);
  const viewId = id("viw");
  const viewFields = headCommit.fields as {
    config?: ViewConfigVO;
    description?: string;
    name?: string;
    slug?: string;
  };
  if (!viewFields.name || !viewFields.slug) {
    throw new Error(`View create commit missing name or slug: ${item.id}`);
  }
  await db.insert(busabaseViews).values({
    id: viewId,
    baseId,
    slug: viewFields.slug,
    name: viewFields.name,
    description: viewFields.description ?? "",
    type: "table",
    config: normalizeViewConfig(viewFields.config ?? {}),
    status: "active",
    createdBy: resolveActorId(CURRENT_USER_ID),
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db
    .update(busabaseOperations)
    .set({ status: "merged", mergedViewId: viewId, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedViewIds.push(viewId);
};

export const mergeViewUpdate = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const targetView = item.targetViewId ? ctx.targetViewsById.get(item.targetViewId) : undefined;
  if (!targetView) {
    throw new Error(`Target view not found: ${item.targetViewId}`);
  }
  const viewFields = headCommit.fields as {
    config?: ViewConfigVO;
    description?: string;
    name?: string;
  };
  await db
    .update(busabaseViews)
    .set({
      config: normalizeViewConfig(viewFields.config ?? targetView.config),
      description: viewFields.description ?? targetView.description,
      name: viewFields.name ?? targetView.name,
      updatedAt: timestamp,
    })
    .where(eq(busabaseViews.id, targetView.id));
  await db
    .update(busabaseOperations)
    .set({ status: "merged", mergedViewId: targetView.id, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedViewIds.push(targetView.id);
};

export const mergeViewDelete = async (ctx: MergeCtx, item: OperationPO, _headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const targetView = item.targetViewId ? ctx.targetViewsById.get(item.targetViewId) : undefined;
  if (!targetView) {
    throw new Error(`Target view not found: ${item.targetViewId}`);
  }
  await db
    .update(busabaseViews)
    .set({ archivedAt: timestamp, status: "archived", updatedAt: timestamp })
    .where(eq(busabaseViews.id, targetView.id));
  await db
    .update(busabaseOperations)
    .set({ status: "archived", mergedViewId: targetView.id, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedViewIds.push(targetView.id);
};

export const mergeRecordUpdate = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const baseId = requireBaseId(item.baseId, item.operation);
  const targetRecord = item.targetRecordId
    ? ctx.targetRecordsById.get(item.targetRecordId)
    : undefined;
  if (!targetRecord) {
    throw new Error(`Target record not found: ${item.targetRecordId}`);
  }

  // When the record moved since this CR's base, the dispatcher resolved a 3-way
  // field merge; land it as a new commit on top of the current canonical head so
  // history stays linear and the intervening edit is preserved. Otherwise this is
  // a fast-forward to the proposed commit.
  const resolvedFields = ctx.resolvedRecordFields.get(item.id);

  // Current stored values (before this update) so created_time/created_by and
  // auto_number survive the edit while updated_time/updated_by are re-stamped.
  const [currentCommit] = await db
    .select({ fields: busabaseCommits.fields })
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, targetRecord.headCommitId))
    .limit(1);
  const fields = await applyComputedRecordFields(ctx, {
    baseId,
    mode: "update",
    fields: resolvedFields ?? headCommit.fields,
    existing: currentCommit?.fields ?? undefined,
  });

  let headCommitId = item.headCommitId;
  if (resolvedFields) {
    headCommitId = id("cmt");
    await db.insert(busabaseCommits).values({
      id: headCommitId,
      baseId,
      targetType: "base",
      nodeId: null,
      operationId: item.id,
      parentCommitId: targetRecord.headCommitId,
      fields,
      operation: "record_update",
      message: `${headCommit.message} (auto-merged)`,
      author: headCommit.author,
      createdAt: timestamp,
    });
  } else {
    // Fast-forward: persist computed values into the proposed commit.
    await db.update(busabaseCommits).set({ fields }).where(eq(busabaseCommits.id, headCommitId));
  }

  await db
    .update(busabaseRecords)
    .set({ headCommitId, updatedAt: timestamp })
    .where(eq(busabaseRecords.id, targetRecord.id));
  await projectCommitFields({
    baseId,
    commitId: headCommitId,
    recordId: targetRecord.id,
    fields,
  });
  await syncRecordAssetUsages(baseId, targetRecord.id, fields);
  await db
    .update(busabaseOperations)
    .set({ status: "merged", mergedRecordId: targetRecord.id, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedRecordIds.push(targetRecord.id);
};

export const mergeRecordDelete = async (
  ctx: MergeCtx,
  item: OperationPO,
  _headCommit: CommitPO,
) => {
  const { db, timestamp } = ctx;
  const targetRecord = item.targetRecordId
    ? ctx.targetRecordsById.get(item.targetRecordId)
    : undefined;
  if (!targetRecord) {
    throw new Error(`Target record not found: ${item.targetRecordId}`);
  }
  await db
    .update(busabaseRecords)
    .set({ status: "archived", archivedAt: timestamp, updatedAt: timestamp })
    .where(eq(busabaseRecords.id, targetRecord.id));
  await removeRecordAssetUsages(targetRecord.id);
  await db
    .update(busabaseOperations)
    .set({ status: "archived", mergedRecordId: targetRecord.id, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedRecordIds.push(targetRecord.id);
};

// node_create materialization for a Base node: the Base node + Base row + fields.
export const materializeBaseNode = async (
  ctx: MergeCtx,
  args: MaterializeArgs,
): Promise<string> => {
  const { db, timestamp } = ctx;
  const { parentNode, fields } = args;
  const baseNodeId = id("nod");
  const baseId = id("bse");
  await db.insert(busabaseNodes).values({
    id: baseNodeId,
    parentId: parentNode.id,
    type: "base",
    slug: fields.slug as string,
    name: fields.name as string,
    description: fields.description ?? "",
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseBases).values({
    id: baseId,
    nodeId: baseNodeId,
    slug: fields.slug as string,
    name: fields.name as string,
    description: fields.description ?? "",
    reviewPolicy: { kind: "single", requiredApprovals: 1 },
    createdAt: timestamp,
  });
  const baseFields =
    fields.fields && fields.fields.length > 0
      ? fields.fields
      : [{ slug: "title", name: "Title", type: "text" as const, required: true, options: {} }];
  await db.insert(busabaseBaseFields).values(
    baseFields.map((field, index) => ({
      id: id("bsf"),
      baseId,
      slug: field.slug,
      name: field.name,
      type: field.type ?? "text",
      required: field.required ?? false,
      position: index,
      options: field.options ?? {},
    })),
  );
  return baseNodeId;
};

registerMaterializer("base", materializeBaseNode);

export const mergeBaseAddField = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const baseId = requireBaseId(item.baseId, item.operation);
  const fieldData = headCommit.fields as {
    name?: string;
    slug?: string;
    type?: import("../../types").FieldType;
    required?: boolean;
    options?: Record<string, unknown>;
  };
  if (!fieldData.name || !fieldData.slug) {
    throw new Error(`base_add_field commit missing name or slug: ${item.id}`);
  }
  const fieldCount = await db
    .select()
    .from(busabaseBaseFields)
    .where(eq(busabaseBaseFields.baseId, baseId))
    .then((rows) => rows.length);
  await db.insert(busabaseBaseFields).values({
    id: id("bsf"),
    baseId,
    slug: fieldData.slug,
    name: fieldData.name,
    type: fieldData.type ?? "text",
    required: fieldData.required ?? false,
    position: fieldCount,
    options: (fieldData.options ?? {}) as BaseFieldPO["options"],
  });
  await db
    .update(busabaseOperations)
    .set({ status: "merged", updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
};
