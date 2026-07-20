import "server-only";

import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { iStringToText } from "openlib/i18n/i-string";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId, withContextSourceMeta } from "../../../context";
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
import {
  getChangeRequest,
  mergeChangeRequest,
  recordMergedNodeCreate,
  recordPendingNodeCreate,
  reviewChangeRequest,
} from "../../../logic/cr-lifecycle";
import { projectCommitFields } from "../../../logic/field-values";
import { CURRENT_USER_ID, id, now, rootNodeIdForSpace } from "../../../logic/kernel";
import { publishChangeRequestPendingReview } from "../../../logic/live-events";
import { assertBaseChangeRequestPermission, initializeNodeAcl } from "../../../logic/node-acl";
import { assertContainerParent } from "../../../logic/node-parent";
import { ensureReady } from "../../../logic/seed";
import {
  createBaseInputSchema,
  createBulkChangeRequestInputSchema,
  createChangeRequestInputSchema,
  createDeleteChangeRequestInputSchema,
  reviseOperationInputSchema,
} from "../../../logic/store";
import { validateRecordFields } from "../field-rules";
import type { FieldDef } from "../field-types";
import { baseNotFound } from "./errors";
import { getBase } from "./queries";
import { resolveRelationFieldOptions } from "./relation-options";

export {
  createBaseInputSchema,
  createBulkChangeRequestInputSchema,
  createChangeRequestInputSchema,
  createDeleteChangeRequestInputSchema,
  reviseOperationInputSchema,
};

/** Caller-supplied recordId doesn't resolve — a genuine "not found" client error. */
const recordNotFound = (recordId: string) =>
  new ORPCError("NOT_FOUND", { message: `Record not found: ${recordId}` });

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

/** Postgres `unique_violation` — both the postgres-js driver and PGLite (a real
 *  Postgres engine) surface the raw driver error's `.code === "23505"`. Drizzle
 *  wraps that in a `DrizzleQueryError` whose own `.code` is undefined but whose
 *  `.cause` is the raw driver error — check both so this doesn't silently miss
 *  the wrapped shape. Used to detect a concurrent idempotency-key race that slipped
 *  past the up-front SELECT check. */
const isUniqueViolation = (error: unknown): boolean => {
  const directCode = (error as { code?: unknown } | null | undefined)?.code;
  if (directCode === "23505") return true;
  const causeCode = (error as { cause?: { code?: unknown } } | null | undefined)?.cause?.code;
  return causeCode === "23505";
};

const findChangeRequestByIdempotencyKey = async (
  db: Awaited<ReturnType<typeof getDb>>,
  baseId: string,
  submittedBy: string,
  idempotencyKey: string,
): Promise<string | null> => {
  const [existing] = await db
    .select({ id: busabaseChangeRequests.id })
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.baseId, baseId),
        eq(busabaseChangeRequests.submittedBy, submittedBy),
        eq(busabaseChangeRequests.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return existing?.id ?? null;
};

// `z.input` (not `z.infer`/output) — matches createDoc/createFileNode/
// createFileTreeNode's parameter typing: callers may omit any field with a
// schema default (including the new `autoMerge`), since `.parse()` below
// fills it in. Using the output type here would wrongly force every caller
// to pass `autoMerge` explicitly just to satisfy the compiler.
export const createBase = async (input: z.input<typeof createBaseInputSchema>) => {
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
      // Idempotent-retry shortcut: only safe when the resubmission actually
      // looks like the SAME intended base. `name` is the cheap, meaningful
      // identity check here — deliberately NOT a deep-equality check of
      // `fields` (option objects can differ incidentally — `{}` vs undefined
      // defaults, key ordering — without representing a different schema).
      // A slug collision with a genuinely different name is a real conflict:
      // silently returning the existing base would discard the caller's
      // submitted name/fields with no signal at all.
      if (existing.name !== parsed.name) {
        throw new ORPCError("CONFLICT", {
          message: `Base slug "${parsed.slug}" is already in use by a different Base ("${existing.name}"). Choose a different slug, or omit "name" differences if you intended to reuse it.`,
        });
      }
      return { ...existing, materialized: true as const };
    }
  }

  const parentNodeId = parsed.parentNodeId ?? rootNodeIdForSpace(getContextSpaceId());
  const [parentNodeRow] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, parentNodeId))
    .limit(1);
  const parentNode = assertContainerParent(parentNodeRow, "base", parentNodeId);

  // Review-first by default: propose the Base as a pending node_create
  // ChangeRequest instead of materializing it immediately. Callers that don't
  // need human review (seed/migration scripts, an explicit no-review agent
  // task) pass `autoMerge: true` to keep today's instant-create behavior.
  if (!parsed.autoMerge) {
    const changeRequest = await recordPendingNodeCreate({
      nodeType: "base",
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      parentNodeId: parentNode.id,
      fields: parsed.fields,
      message: `Create base ${parsed.name}`,
      submittedBy: resolveActorId(CURRENT_USER_ID),
    });
    return { ...changeRequest, materialized: false as const };
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
  await initializeNodeAcl(db, spaceId, nodeId, parentNode.id, resolveActorId(CURRENT_USER_ID));
  if (parsed.fields.length > 0) {
    await db.insert(busabaseBaseFields).values(
      await Promise.all(
        parsed.fields.map(async (field, index) => ({
          id: id("bsf"),
          spaceId,
          baseId,
          slug: field.slug,
          name: iStringToText(field.name),
          type: field.type,
          required: field.required,
          position: index,
          options: await resolveRelationFieldOptions(db, field.options),
        })),
      ),
    );
  }

  const base = await getBase(baseId);
  if (!base) {
    throw new Error("Failed to create base");
  }
  // Record the create as an auto-merged structural ChangeRequest (audit +
  // history + rollback), replacing the old bespoke `base.created` audit action.
  await recordMergedNodeCreate({
    nodeId,
    baseId,
    nodeType: "base",
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    parentNodeId: parentNode.id,
    message: `Create base ${parsed.name}`,
    submittedBy: resolveActorId(CURRENT_USER_ID),
  });
  return { ...base, materialized: true as const };
};

export const createChangeRequest = async (
  baseId: string,
  // `z.input` (not `z.infer`/output) — matches createBase/createDoc/
  // createFileNode/createFileTreeNode: callers may omit any field with a
  // schema default (e.g. `autoMerge`), since `.parse()` below fills it in.
  input: z.input<typeof createChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw baseNotFound(baseId);
  }
  // ChangeRequest-submission gate (node ACL): read-level visibility (getBase
  // above) is not enough to propose — requires `changeRequest` level.
  await assertBaseChangeRequestPermission(base.id);

  const parsed = createChangeRequestInputSchema.parse(input);
  assertValidRecordFields(parsed.fields, base.fields);
  await assertRelationTargetsLive(parsed.fields, base.fields);
  const submittedBy = resolveActorId(parsed.submittedBy);

  // Idempotency: a client-supplied key lets a retry (e.g. after a timeout, or
  // after a false-500 like the live-event-publish bug fixed alongside this)
  // return the SAME change request instead of creating a content-identical
  // duplicate. Scoped by base + submitter, checked up front so the common
  // sequential-retry case never touches the write path below at all.
  if (parsed.idempotencyKey) {
    const existingId = await findChangeRequestByIdempotencyKey(
      db,
      base.id,
      submittedBy,
      parsed.idempotencyKey,
    );
    if (existingId) {
      const existing = await getChangeRequest(existingId);
      if (existing) {
        // Retry returns whatever the first call produced, as-is (merged or
        // still pending) — always the ChangeRequestVO shape, never re-derived
        // as a record, even if the original call also passed autoMerge.
        return { ...existing, materialized: false as const };
      }
    }
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();

  // Insert the ChangeRequest row FIRST (ahead of its commit/operation) so the
  // partial unique index on (baseId, submittedBy, idempotencyKey) — the
  // concurrent-race safety net behind the up-front check above — rejects a
  // colliding retry before any commit/operation row is written, instead of
  // after, which would otherwise leave an orphaned commit behind.
  try {
    await db.insert(busabaseChangeRequests).values({
      id: changeRequestId,
      baseId: base.id,
      status: "in_review",
      submittedBy,
      idempotencyKey: parsed.idempotencyKey ?? null,
      sourceMeta: withContextSourceMeta({}),
      reviewPolicySnapshot: base.reviewPolicy,
      mergeSummary: {},
      rejectedReason: null,
      reviewedAt: null,
      mergedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } catch (error) {
    if (parsed.idempotencyKey && isUniqueViolation(error)) {
      const existingId = await findChangeRequestByIdempotencyKey(
        db,
        base.id,
        submittedBy,
        parsed.idempotencyKey,
      );
      if (existingId) {
        const existing = await getChangeRequest(existingId);
        if (existing) {
          return { ...existing, materialized: false as const };
        }
      }
    }
    throw error;
  }

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

  // NOT wrapped: this projects the proposed field values reviewers/search/list
  // depend on — unlike the audit log and live notification below, a failure
  // here would leave a "successfully created" CR that's silently missing its
  // substantive data, which is worse than surfacing the error (a retry with
  // the same idempotencyKey is now safe either way, thanks to the check above).
  await projectCommitFields({
    baseId: base.id,
    commitId,
    changeRequestId,
    operationId,
    fields: parsed.fields,
  });
  try {
    await insertAuditEvent(db, {
      action: "change_request.created",
      actorId: parsed.submittedBy,
      baseId: base.id,
      changeRequestId,
      operationId,
      commitId,
      metadata: { operation: "record_create" },
    });
  } catch {
    // Best-effort — an audit-log write failure must never fail change-request
    // creation; the CR/operation/commit rows above are already durably committed.
  }
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: base.id,
    changeRequestId,
    submittedBy,
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create changeRequest");
  }

  // Review-first by default (see the schema doc on `autoMerge` above). A caller
  // that doesn't need human review approves and merges right away, so it gets
  // the materialized record back instead of having to poll/approve/merge itself
  // in three separate calls — matching createBase's autoMerge shortcut.
  if (parsed.autoMerge) {
    await reviewChangeRequest(changeRequestId, { verdict: "approved" });
    const merged = await mergeChangeRequest(changeRequestId);
    if (!merged.record) {
      throw new Error("Auto-merge did not produce a record");
    }
    return { ...merged.record, materialized: true as const };
  }
  return { ...changeRequest, materialized: false as const };
};

/**
 * Propose many record creates as ONE change request: a single CR with N
 * `record_create` operations (one commit each), so a reviewer sees one item and
 * merge applies all N in the existing single transaction. Mirrors the per-operation
 * shape of {@link createChangeRequest} in a loop.
 *
 * Every record is validated up front so a bad row rejects the whole batch before any
 * write (the batch is not wrapped in a DB transaction — matching the single-record
 * path — so up-front validation is what keeps the common failure clean).
 */
export const createBulkChangeRequest = async (
  baseId: string,
  input: z.infer<typeof createBulkChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw baseNotFound(baseId);
  }
  // ChangeRequest-submission gate (node ACL) — same as createChangeRequest.
  await assertBaseChangeRequestPermission(base.id);

  const parsed = createBulkChangeRequestInputSchema.parse(input);
  // Validate the entire batch before writing anything, so one bad record fails fast
  // instead of leaving a partially-populated change request behind.
  for (const fields of parsed.records) {
    assertValidRecordFields(fields, base.fields);
    await assertRelationTargetsLive(fields, base.fields);
  }
  const submittedBy = resolveActorId(parsed.submittedBy);

  // Idempotency — see the identical comment in createChangeRequest above.
  if (parsed.idempotencyKey) {
    const existingId = await findChangeRequestByIdempotencyKey(
      db,
      base.id,
      submittedBy,
      parsed.idempotencyKey,
    );
    if (existingId) {
      const existing = await getChangeRequest(existingId);
      if (existing) {
        return existing;
      }
    }
  }

  const changeRequestId = id("crq");
  const timestamp = now();

  try {
    await db.insert(busabaseChangeRequests).values({
      id: changeRequestId,
      baseId: base.id,
      status: "in_review",
      submittedBy,
      idempotencyKey: parsed.idempotencyKey ?? null,
      sourceMeta: withContextSourceMeta({ bulk: true, recordCount: parsed.records.length }),
      reviewPolicySnapshot: base.reviewPolicy,
      mergeSummary: {},
      rejectedReason: null,
      reviewedAt: null,
      mergedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } catch (error) {
    if (parsed.idempotencyKey && isUniqueViolation(error)) {
      const existingId = await findChangeRequestByIdempotencyKey(
        db,
        base.id,
        submittedBy,
        parsed.idempotencyKey,
      );
      if (existingId) {
        const existing = await getChangeRequest(existingId);
        if (existing) {
          return existing;
        }
      }
    }
    throw error;
  }

  for (const [position, fields] of parsed.records.entries()) {
    const operationId = id("opr");
    const commitId = id("cmt");
    await db.insert(busabaseCommits).values({
      id: commitId,
      baseId: base.id,
      operationId: null,
      parentCommitId: null,
      fields,
      operation: "record_create",
      message: parsed.message,
      author: "producer",
      createdAt: timestamp,
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
      position,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
    await projectCommitFields({
      baseId: base.id,
      commitId,
      changeRequestId,
      operationId,
      fields,
    });
  }

  try {
    await insertAuditEvent(db, {
      action: "change_request.created",
      actorId: parsed.submittedBy,
      baseId: base.id,
      changeRequestId,
      metadata: { operation: "record_create", bulk: true, recordCount: parsed.records.length },
    });
  } catch {
    // Best-effort — an audit-log write failure must never fail change-request
    // creation; the CR/operation/commit rows above are already durably committed.
  }
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: base.id,
    changeRequestId,
    submittedBy,
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create bulk changeRequest");
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
    throw recordNotFound(recordId);
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
    sourceMeta: withContextSourceMeta({}),
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
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: record.baseId,
    changeRequestId,
    submittedBy: resolveActorId(parsed.submittedBy),
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
    throw recordNotFound(recordId);
  }
  if (record.status === "archived") {
    throw new Error(`Record is already archived: ${recordId}`);
  }

  const base = await getBase(record.baseId);
  if (!base) {
    throw new Error(`Base not found: ${record.baseId}`);
  }
  // `parsed.fields` is only the caller's partial delta — an omitted required
  // field means "leave it alone", not "this record has no value for it".
  // Validate against the MERGED view (current committed fields + delta) so the
  // required-check only fires when a field is genuinely missing a value, not
  // merely un-resubmitted. This mirrors mergeRecordUpdate in merge/record.ts,
  // which already merges the same way before persisting; what actually gets
  // stored as the commit's delta (parsed.fields) is untouched by this — only
  // the requiredness CHECK sees the merged fields.
  const [currentCommit] = await db
    .select({ fields: busabaseCommits.fields })
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, record.headCommitId))
    .limit(1);
  const mergedFieldsForValidation = {
    ...(currentCommit?.fields as Record<string, unknown> | undefined),
    ...parsed.fields,
  };
  assertValidRecordFields(mergedFieldsForValidation, base.fields);
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
    sourceMeta: withContextSourceMeta({}),
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
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: record.baseId,
    changeRequestId,
    submittedBy: resolveActorId(parsed.author),
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
    throw recordNotFound(recordId);
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
    sourceMeta: withContextSourceMeta({}),
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
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: record.baseId,
    changeRequestId,
    submittedBy: resolveActorId(submittedBy),
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
    throw baseNotFound(baseId);
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
    sourceMeta: withContextSourceMeta({ subject: "base_archive" }),
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
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: base.id,
    changeRequestId,
    submittedBy: resolveActorId(submittedBy),
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
  // getBase's id-fallback excludes a permanently-deleted base (deletedAt IS NOT
  // NULL) but still resolves a merely-archived one, so it can't be used alone
  // here — fall back to a raw lookup that also finds an archived (not yet
  // purged) base, then re-check deletedAt explicitly below.
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
    throw baseNotFound(baseId);
  }
  const [baseRow] = await db
    .select()
    .from(busabaseBases)
    .where(eq(busabaseBases.id, resolvedId))
    .limit(1);
  if (!baseRow) {
    throw baseNotFound(baseId);
  }
  if (baseRow.deletedAt) {
    throw new ORPCError("CONFLICT", {
      message: `Base was permanently deleted and cannot be restored: ${baseId}`,
    });
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
    sourceMeta: withContextSourceMeta({ subject: "base_restore" }),
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
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: baseRow.id,
    changeRequestId,
    submittedBy: resolveActorId(submittedBy),
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create restore base change request");
  }
  return changeRequest;
};
