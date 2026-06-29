import "server-only";

import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId } from "../../../context";
import { getDb } from "../../../db";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseChangeRequests,
  busabaseCommits,
  busabaseNodes,
  busabaseOperations,
  busabaseRecords,
} from "../../../db/schema";
import { insertAuditEvent } from "../../../logic/audit";
import { getChangeRequest } from "../../../logic/cr-lifecycle";
import { projectCommitFields } from "../../../logic/field-values";
import { id, now, rootNodeIdForSpace } from "../../../logic/kernel";
import { ensureReady } from "../../../logic/seed";
import {
  createBaseInputSchema,
  createChangeRequestInputSchema,
  createDeleteChangeRequestInputSchema,
  reviseOperationInputSchema,
} from "../../../logic/store";
import { validateRecordFields } from "../field-rules";
import type { FieldDef } from "../field-types";
import { getBase } from "./queries";

export {
  createBaseInputSchema,
  createChangeRequestInputSchema,
  createDeleteChangeRequestInputSchema,
  reviseOperationInputSchema,
};

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

/**
 * Reject record writes whose relation fields point at an archived target base —
 * linking into a base that has been archived would create dangling references.
 */
const assertRelationTargetsLive = async (
  fields: Record<string, unknown>,
  defs: ReadonlyArray<FieldDef>,
) => {
  const targetBaseIds = new Set<string>();
  for (const def of defs) {
    if (def.type !== "relation") continue;
    const value = fields[def.slug];
    if (value === undefined || value === null) continue;
    const hasValue = Array.isArray(value) ? value.length > 0 : true;
    if (!hasValue) continue;
    const targetBaseId = (def.options as { targetBaseId?: string } | undefined)?.targetBaseId;
    if (targetBaseId) targetBaseIds.add(targetBaseId);
  }
  if (targetBaseIds.size === 0) return;

  const db = await getDb();
  const rows = await db
    .select({ id: busabaseBases.id, archivedAt: busabaseBases.archivedAt })
    .from(busabaseBases)
    .where(inArray(busabaseBases.id, [...targetBaseIds]));
  const archived = rows.filter((row) => row.archivedAt).map((row) => row.id);
  if (archived.length > 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Cannot link to archived base${archived.length === 1 ? "" : "s"}: ${archived.join(
        ", ",
      )}. Restore the target base first.`,
      data: { archivedTargetBaseIds: archived },
    });
  }
};

export const createBase = async (input: z.infer<typeof createBaseInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = createBaseInputSchema.parse(input);
  // Idempotent create only matches an ACTIVE base with this slug. An archived
  // base no longer owns the slug (both the base and node unique indexes are
  // partial on archivedAt), so the slug is free for a brand-new base.
  const [existingActive] = await db
    .select({ id: busabaseBases.id })
    .from(busabaseBases)
    .where(
      and(
        eq(busabaseBases.slug, parsed.slug),
        eq(busabaseBases.spaceId, getContextSpaceId()),
        isNull(busabaseBases.archivedAt),
      ),
    )
    .limit(1);
  if (existingActive) {
    const existing = await getBase(existingActive.id);
    if (existing) {
      return existing;
    }
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
  const spaceId = getContextSpaceId();
  await db.insert(busabaseNodes).values({
    id: nodeId,
    spaceId,
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
    spaceId,
    nodeId,
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    reviewPolicy: { kind: "single", requiredApprovals: 1 },
    createdAt,
  });
  if (parsed.fields.length > 0) {
    await db.insert(busabaseBaseFields).values(
      parsed.fields.map((field, index) => ({
        id: id("bsf"),
        spaceId,
        baseId,
        slug: field.slug,
        name: field.name,
        type: field.type,
        required: field.required,
        position: index,
        options: field.options,
      })),
    );
  }

  const base = await getBase(baseId);
  if (!base) {
    throw new Error("Failed to create base");
  }
  return base;
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
  await assertRelationTargetsLive(parsed.fields, base.fields);
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
    .where(and(eq(busabaseRecords.id, recordId), eq(busabaseRecords.spaceId, getContextSpaceId())))
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
    .where(and(eq(busabaseRecords.id, recordId), eq(busabaseRecords.spaceId, getContextSpaceId())))
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
  await assertRelationTargetsLive(parsed.fields, base.fields);

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
    baseCommitId: parsed.baseCommitId ?? record.headCommitId,
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

export const createRestoreChangeRequest = async (
  recordId: string,
  submittedBy = "local-editor",
  message?: string,
) => {
  await ensureReady();
  const db = await getDb();
  const [record] = await db
    .select()
    .from(busabaseRecords)
    .where(and(eq(busabaseRecords.id, recordId), eq(busabaseRecords.spaceId, getContextSpaceId())))
    .limit(1);
  if (!record) {
    throw new Error(`Record not found: ${recordId}`);
  }
  if (record.status !== "archived") {
    throw new Error(`Record is not archived: ${recordId}`);
  }

  const [headCommit] = await db
    .select()
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, record.headCommitId))
    .limit(1);
  if (!headCommit) {
    throw new Error(`Record head commit not found: ${record.headCommitId}`);
  }

  const base = await getBase(record.baseId);
  if (!base) {
    throw new Error(`Base not found: ${record.baseId}`);
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
    operation: "record_restore",
    message: message ?? "Restore record",
    author: "producer",
    createdAt: timestamp,
  });

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: record.baseId,
    status: "in_review",
    submittedBy: resolveActorId(submittedBy),
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
    operation: "record_restore",
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
  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: submittedBy,
    baseId: record.baseId,
    recordId: record.id,
    changeRequestId,
    operationId,
    commitId,
    metadata: { operation: "record_restore" },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create restore changeRequest");
  }
  return changeRequest;
};

export const createArchiveBaseChangeRequest = async (
  baseId: string,
  submittedBy = "local-editor",
  message?: string,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const fields = { baseId: base.id, slug: base.slug };

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "base_archive",
    message: message ?? "Archive base",
    author: submittedBy,
    createdAt: timestamp,
  });

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: base.id,
    status: "in_review",
    submittedBy: resolveActorId(submittedBy),
    sourceMeta: { subject: "base_archive" },
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
    operation: "base_archive",
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
    actorId: submittedBy,
    baseId: base.id,
    changeRequestId,
    operationId,
    commitId,
    metadata: { operation: "base_archive" },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create archive base change request");
  }
  return changeRequest;
};

export const createRestoreBaseChangeRequest = async (
  baseId: string,
  submittedBy = "local-editor",
  message?: string,
) => {
  await ensureReady();
  const db = await getDb();
  // getBase only returns non-archived bases via the VO? It returns by id/slug
  // regardless of archivedAt, so resolve directly here too.
  const base = await getBase(baseId);
  let resolvedId = base?.id ?? null;
  if (!resolvedId) {
    const [row] = await db
      .select({ id: busabaseBases.id })
      .from(busabaseBases)
      .where(eq(busabaseBases.id, baseId))
      .limit(1);
    resolvedId = row?.id ?? null;
  }
  if (!resolvedId) {
    throw new Error(`Base not found: ${baseId}`);
  }
  const [baseRow] = await db
    .select()
    .from(busabaseBases)
    .where(eq(busabaseBases.id, resolvedId))
    .limit(1);
  if (!baseRow) {
    throw new Error(`Base not found: ${baseId}`);
  }
  if (!baseRow.archivedAt) {
    throw new Error(`Base is not archived: ${baseId}`);
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const fields = { baseId: baseRow.id, slug: baseRow.slug };

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: baseRow.id,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "base_restore",
    message: message ?? "Restore base",
    author: submittedBy,
    createdAt: timestamp,
  });

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: baseRow.id,
    status: "in_review",
    submittedBy: resolveActorId(submittedBy),
    sourceMeta: { subject: "base_restore" },
    reviewPolicySnapshot: baseRow.reviewPolicy,
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
    baseId: baseRow.id,
    operation: "base_restore",
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
    actorId: submittedBy,
    baseId: baseRow.id,
    changeRequestId,
    operationId,
    commitId,
    metadata: { operation: "base_restore" },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create restore base change request");
  }
  return changeRequest;
};
