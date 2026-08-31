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
  busabaseForms,
  busabaseNodes,
  busabaseOperations,
  busabaseRecords,
} from "../../../db/schema";
import { insertAuditEvent } from "../../../logic/audit";
import { insertCommit } from "../../../logic/commits";
import {
  finalizeChangeRequest,
  getChangeRequest,
  hydrateChangeRequest,
  mergeChangeRequest,
  recordMergedNodeCreate,
  recordPendingNodeCreate,
  reviewChangeRequest,
} from "../../../logic/cr-lifecycle";
import { projectCommitFields } from "../../../logic/field-values";
import { CURRENT_USER_ID, id, now, rootNodeIdForSpace } from "../../../logic/kernel";
import { publishChangeRequestPendingReview } from "../../../logic/live-events";
import {
  assertBaseChangeRequestPermission,
  hasNodePermission,
  initializeNodeAcl,
  shouldAutoMerge,
} from "../../../logic/node-acl";
import { assertContainerParent } from "../../../logic/node-parent";
import { isNodeSlugUniqueViolation, nodeSlugConflict } from "../../../logic/node-slug";
import { ensureReady } from "../../../logic/seed";
import {
  createBaseInputSchema,
  createBulkChangeRequestInputSchema,
  createBulkUpdateChangeRequestInputSchema,
  createChangeRequestInputSchema,
  createDeleteChangeRequestInputSchema,
  updateRecordChangeRequestInputSchema,
} from "../../../logic/store";
import { toBaseVO } from "../../../logic/vo";
import { assertValidFormulaField, validateRecordFields } from "../field-rules";
import type { FieldDef } from "../field-types";
import { FormulaError } from "../formula";
import { baseNotFound } from "./errors";
import { resolveLookupFieldOptions } from "./field-ops";
import { getBase } from "./queries";
import { resolveRelationFieldOptions } from "./relation-options";

export {
  createBaseInputSchema,
  createBulkChangeRequestInputSchema,
  createBulkUpdateChangeRequestInputSchema,
  createChangeRequestInputSchema,
  createDeleteChangeRequestInputSchema,
  updateRecordChangeRequestInputSchema,
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
const assertRelationTargetsLiveBatch = async (
  fieldSets: ReadonlyArray<Record<string, unknown>>,
  defs: ReadonlyArray<FieldDef>,
) => {
  const targetBaseIds = new Set<string>();
  for (const fields of fieldSets) {
    for (const def of defs) {
      if (def.type !== "relation") continue;
      const value = fields[def.slug];
      if (value === undefined || value === null) continue;
      const hasValue = Array.isArray(value) ? value.length > 0 : true;
      if (!hasValue) continue;
      const targetBaseId = (def.options as { targetBaseId?: string } | undefined)?.targetBaseId;
      if (targetBaseId) targetBaseIds.add(targetBaseId);
    }
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

const assertRelationTargetsLive = async (
  fields: Record<string, unknown>,
  defs: ReadonlyArray<FieldDef>,
) => assertRelationTargetsLiveBatch([fields], defs);

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
  // Validate every `formula` field in the INITIAL field set against each
  // other (self-ref, unknown-ref, whole-set cycle) — createBaseField/
  // createFieldChangeRequest/updateFieldChangeRequest validate a field added
  // one at a time against the base's EXISTING fields, but a brand-new base's
  // fields all arrive in this one batch with no prior existence to check
  // against individually.
  for (const field of parsed.fields) {
    try {
      assertValidFormulaField(field.type, field.slug, field.options, parsed.fields);
    } catch (error) {
      if (error instanceof FormulaError) {
        throw new ORPCError("BAD_REQUEST", { message: error.message });
      }
      throw error;
    }
  }
  // Same story for `lookup` fields in the initial set: they reference a sibling
  // `relation` field that only exists in THIS payload, so they are validated
  // against the payload rather than any persisted state. Relation options are
  // resolved FIRST (targetBaseSlug → targetBaseId) because that is exactly what
  // a lookup needs to find its target Base. The lookup TARGET Base is a
  // different, already-existing Base — a relation field cannot be created
  // without a resolvable targetBaseId — so it is safe to load here.
  const relationResolvedFields = await Promise.all(
    parsed.fields.map(async (field) => ({
      ...field,
      options: await resolveRelationFieldOptions(db, field.options),
    })),
  );
  const resolvedFields = await Promise.all(
    relationResolvedFields.map(async (field) => ({
      ...field,
      options: await resolveLookupFieldOptions(
        field.type,
        field.slug,
        field.options,
        relationResolvedFields,
      ),
    })),
  );
  const parentNodeId = parsed.parentNodeId ?? rootNodeIdForSpace(getContextSpaceId());

  // Idempotent create only applies to the exact same parent/type/slug target.
  // The slug identity itself is space-wide by type, so finding it under a
  // different parent is a conflict rather than a retry of that existing Base.
  const [existingActive] = await db
    .select({ id: busabaseBases.id, parentId: busabaseNodes.parentId })
    .from(busabaseBases)
    .innerJoin(busabaseNodes, eq(busabaseBases.nodeId, busabaseNodes.id))
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
      if (existingActive.parentId !== parentNodeId || existing.name !== parsed.name) {
        throw nodeSlugConflict("base", parsed.slug);
      }
      return { ...existing, materialized: true as const };
    }
  }

  const [parentNodeRow] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, parentNodeId))
    .limit(1);
  const parentNode = assertContainerParent(parentNodeRow, "base", parentNodeId);

  // Permission-aware default: merge immediately if the actor has `write` on
  // the parent node; otherwise (or with explicit `autoMerge: false`) propose
  // the Base as a pending node_create ChangeRequest instead.
  const autoMerge = shouldAutoMerge(
    parsed.autoMerge,
    await hasNodePermission(parentNode.id, "write"),
  );

  if (!autoMerge) {
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
  try {
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
  } catch (error) {
    if (isNodeSlugUniqueViolation(error)) {
      throw nodeSlugConflict("base", parsed.slug);
    }
    throw error;
  }

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
  if (resolvedFields.length > 0) {
    // `resolvedFields` already carries the relation- and lookup-resolved options
    // computed (and validated) above — don't resolve a second time.
    await db.insert(busabaseBaseFields).values(
      resolvedFields.map((field, index) => ({
        id: id("bsf"),
        spaceId,
        baseId,
        slug: field.slug,
        name: iStringToText(field.name),
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

type CreateChangeRequestInput = z.input<typeof createChangeRequestInputSchema>;

type CreateChangeRequestAuthorization = { kind: "base" } | { kind: "form"; formNodeId: string };

/**
 * Resolve the private Base behind an already-authorized Form submission.
 * The Form-to-Base relationship is checked again here so this narrow entry
 * point cannot be used to target an arbitrary Base.
 */
const getFormSubmissionBase = async (formNodeId: string, baseId: string) => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [row] = await db
    .select({ base: busabaseBases, nodeMetadata: busabaseNodes.metadata })
    .from(busabaseBases)
    .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseBases.nodeId))
    .innerJoin(
      busabaseForms,
      and(eq(busabaseForms.targetBaseId, busabaseBases.id), eq(busabaseForms.nodeId, formNodeId)),
    )
    .where(
      and(
        eq(busabaseBases.id, baseId),
        eq(busabaseBases.spaceId, spaceId),
        eq(busabaseForms.spaceId, spaceId),
        eq(busabaseForms.status, "active"),
        isNull(busabaseBases.archivedAt),
        isNull(busabaseBases.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  const fields = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, row.base.id), isNull(busabaseBaseFields.deletedAt)));
  return toBaseVO(row.base, fields, row.nodeMetadata);
};

/** Load a CR just created through the Form-authorized path without widening
 * the normal CR read surface to the private target Base. */
const getFormSubmissionChangeRequest = async (changeRequestId: string) => {
  const db = await getDb();
  const [changeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.id, changeRequestId),
        eq(busabaseChangeRequests.spaceId, getContextSpaceId()),
      ),
    )
    .limit(1);
  return changeRequest ? hydrateChangeRequest(changeRequest) : null;
};

const createChangeRequestInternal = async (
  baseId: string,
  // `z.input` (not `z.infer`/output) — matches createBase/createDoc/
  // createFileNode/createFileTreeNode: callers may omit any field with a
  // schema default (e.g. `autoMerge`), since `.parse()` below fills it in.
  input: CreateChangeRequestInput,
  authorization: CreateChangeRequestAuthorization,
) => {
  await ensureReady();
  const db = await getDb();
  const base =
    authorization.kind === "form"
      ? await getFormSubmissionBase(authorization.formNodeId, baseId)
      : await getBase(baseId);
  if (!base) {
    throw baseNotFound(baseId);
  }
  // ChangeRequest-submission gate (node ACL): read-level visibility (getBase
  // above) is not enough to propose — requires `changeRequest` level.
  if (authorization.kind === "base") {
    await assertBaseChangeRequestPermission(base.id);
  }

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
      const existing =
        authorization.kind === "form"
          ? await getFormSubmissionChangeRequest(existingId)
          : await getChangeRequest(existingId);
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
        const existing =
          authorization.kind === "form"
            ? await getFormSubmissionChangeRequest(existingId)
            : await getChangeRequest(existingId);
        if (existing) {
          return { ...existing, materialized: false as const };
        }
      }
    }
    throw error;
  }

  await insertCommit(db, {
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    payload: parsed.fields,
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

  const changeRequest =
    authorization.kind === "form"
      ? await getFormSubmissionChangeRequest(changeRequestId)
      : await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create changeRequest");
  }

  // Permission-aware default (see the schema doc on `autoMerge` above): merge
  // immediately — approve + merge right away, so the caller gets the
  // materialized record back instead of having to poll/approve/merge itself
  // in three separate calls — if the actor has `write` on the Base's node.
  // Node-scoped on purpose (not `reviewChangeRequest`/`mergeChangeRequest`'s
  // own internal workspace-level check), consistent with createBase/createDoc/
  // createFileNode/createFileTreeNode: a node-ACL-restricted actor with a
  // globally `write`+ API key still can't auto-merge onto a node they don't
  // have node-level write on.
  const autoMerge = shouldAutoMerge(
    parsed.autoMerge,
    await hasNodePermission(base.nodeId, "write", submittedBy),
  );
  if (autoMerge) {
    await reviewChangeRequest(changeRequestId, { verdict: "approved" });
    const merged = await mergeChangeRequest(changeRequestId);
    if (!merged.record) {
      throw new Error("Auto-merge did not produce a record");
    }
    return { ...merged.record, materialized: true as const };
  }
  return { ...changeRequest, materialized: false as const };
};

/** Normal Base mutation entry: visibility + changeRequest permission required. */
export const createChangeRequest = async (baseId: string, input: CreateChangeRequestInput) =>
  createChangeRequestInternal(baseId, input, { kind: "base" });

/**
 * Form-only proposal entry. Form logic must authorize the Form before calling;
 * this function verifies the active Form still targets the Base, then creates
 * a pending proposal without exposing or sharing that Base with the visitor.
 */
export const createFormSubmissionChangeRequest = async (
  formNodeId: string,
  baseId: string,
  input: CreateChangeRequestInput,
) =>
  createChangeRequestInternal(baseId, { ...input, autoMerge: false }, { kind: "form", formNodeId });

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
    await insertCommit(db, {
      id: commitId,
      baseId: base.id,
      operationId: null,
      parentCommitId: null,
      payload: fields,
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
  return finalizeChangeRequest({
    changeRequestId,
    nodeId: base.nodeId,
    requestedAutoMerge: parsed.autoMerge,
    submittedBy,
    baseId: base.id,
    label: "bulk record",
    // record_create operations — must not take the structural fast path.
    kind: "content",
  });
};

/**
 * Propose partial updates to many existing records as one atomic ChangeRequest.
 * Validation happens before the transaction; the transaction then creates the
 * CR, commits, operations, and field projections as one unit.
 */
export const createBulkUpdateChangeRequest = async (
  baseId: string,
  input: z.input<typeof createBulkUpdateChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) throw baseNotFound(baseId);

  const parsed = createBulkUpdateChangeRequestInputSchema.parse(input);
  const submittedBy = resolveActorId(parsed.submittedBy);
  await assertBaseChangeRequestPermission(base.id, submittedBy);

  if (parsed.idempotencyKey) {
    const existingId = await findChangeRequestByIdempotencyKey(
      db,
      base.id,
      submittedBy,
      parsed.idempotencyKey,
    );
    if (existingId) {
      const existing = await getChangeRequest(existingId);
      if (existing) return existing;
    }
  }

  const recordIds = parsed.updates.map((update) => update.recordId);
  const recordRows = await db
    .select()
    .from(busabaseRecords)
    .where(
      and(inArray(busabaseRecords.id, recordIds), eq(busabaseRecords.spaceId, getContextSpaceId())),
    );
  const recordsById = new Map(recordRows.map((record) => [record.id, record]));
  const getValidatedRecord = (recordId: string) => {
    const record = recordsById.get(recordId);
    if (!record) throw recordNotFound(recordId);
    return record;
  };

  for (const update of parsed.updates) {
    const record = getValidatedRecord(update.recordId);
    if (record.baseId !== base.id) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Record ${record.id} does not belong to base ${base.id}`,
      });
    }
    if (record.status === "archived") {
      throw new ORPCError("CONFLICT", {
        message: `Record is already archived: ${record.id}`,
      });
    }
  }

  // One bounded query supplies every current payload and caller-pinned base
  // commit. Ownership comes from the commit's merged operation, avoiding an
  // unbounded scan of a long-lived Base's entire commit history.
  const requestedCommitIds = [
    ...recordRows.map((record) => record.headCommitId),
    ...parsed.updates.flatMap((update) => (update.baseCommitId ? [update.baseCommitId] : [])),
  ];
  const commitRows = await db
    .select({
      id: busabaseCommits.id,
      parentCommitId: busabaseCommits.parentCommitId,
      payload: busabaseCommits.payload,
    })
    .from(busabaseCommits)
    .where(
      and(
        eq(busabaseCommits.baseId, base.id),
        inArray(busabaseCommits.id, [...new Set(requestedCommitIds)]),
      ),
    );
  const commitsById = new Map(commitRows.map((commit) => [commit.id, commit]));
  const unresolvedBaseCommits = new Map<
    string,
    { candidateId: string; cursorId: string; visited: Set<string> }
  >();
  for (const update of parsed.updates) {
    const record = getValidatedRecord(update.recordId);
    const currentCommit = commitsById.get(record.headCommitId);
    if (!currentCommit) {
      throw new ORPCError("CONFLICT", {
        message: `Current commit is missing for record ${record.id}`,
      });
    }
    if (update.baseCommitId && update.baseCommitId !== record.headCommitId) {
      if (!commitsById.has(update.baseCommitId)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `baseCommitId ${update.baseCommitId} is not in record ${record.id}'s history`,
        });
      }
      unresolvedBaseCommits.set(record.id, {
        candidateId: update.baseCommitId,
        cursorId: record.headCommitId,
        visited: new Set([record.headCommitId]),
      });
    }
    assertValidRecordFields(
      { ...(currentCommit.payload as Record<string, unknown>), ...update.fields },
      base.fields,
    );
  }

  // Walk only the histories involved in this request. The walk advances every
  // unresolved record one parent at a time and batch-loads each frontier, so a
  // legacy/seed commit with no operationId remains a valid optimistic-lock base
  // without scanning every commit ever written to the Base.
  while (unresolvedBaseCommits.size > 0) {
    const nextCommitIds = new Set<string>();
    for (const [recordId, state] of unresolvedBaseCommits) {
      const parentCommitId = commitsById.get(state.cursorId)?.parentCommitId ?? null;
      if (parentCommitId === state.candidateId) {
        unresolvedBaseCommits.delete(recordId);
        continue;
      }
      if (!parentCommitId || state.visited.has(parentCommitId)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `baseCommitId ${state.candidateId} is not in record ${recordId}'s history`,
        });
      }
      state.cursorId = parentCommitId;
      state.visited.add(parentCommitId);
      if (!commitsById.has(parentCommitId)) nextCommitIds.add(parentCommitId);
    }
    if (nextCommitIds.size === 0) continue;

    const parentCommits = await db
      .select({
        id: busabaseCommits.id,
        parentCommitId: busabaseCommits.parentCommitId,
        payload: busabaseCommits.payload,
      })
      .from(busabaseCommits)
      .where(
        and(eq(busabaseCommits.baseId, base.id), inArray(busabaseCommits.id, [...nextCommitIds])),
      );
    for (const commit of parentCommits) commitsById.set(commit.id, commit);
    const missingCommitId = [...nextCommitIds].find((commitId) => !commitsById.has(commitId));
    if (missingCommitId) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Commit ${missingCommitId} is missing from record history`,
      });
    }
  }
  await assertRelationTargetsLiveBatch(
    parsed.updates.map((update) => update.fields),
    base.fields,
  );
  const fieldDefs = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, base.id), isNull(busabaseBaseFields.deletedAt)));

  const changeRequestId = id("crq");
  const timestamp = now();

  try {
    await db.transaction(async (tx) => {
      // Drizzle's postgres-js and PGLite transaction types are structurally
      // compatible with the shared writers, but their HKT union is not.
      const writer = tx as unknown as Awaited<ReturnType<typeof getDb>>;
      await writer.insert(busabaseChangeRequests).values({
        id: changeRequestId,
        baseId: base.id,
        status: "in_review",
        submittedBy,
        idempotencyKey: parsed.idempotencyKey ?? null,
        sourceMeta: withContextSourceMeta({
          bulk: true,
          operation: "record_update",
          recordCount: parsed.updates.length,
        }),
        reviewPolicySnapshot: base.reviewPolicy,
        mergeSummary: {},
        rejectedReason: null,
        reviewedAt: null,
        mergedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      for (const [position, update] of parsed.updates.entries()) {
        const record = getValidatedRecord(update.recordId);
        const operationId = id("opr");
        const commitId = id("cmt");
        await insertCommit(writer, {
          id: commitId,
          baseId: base.id,
          operationId: null,
          parentCommitId: record.headCommitId,
          payload: update.fields,
          operation: "record_update",
          message: update.message ?? parsed.message,
          author: submittedBy,
          createdAt: timestamp,
        });
        await writer.insert(busabaseOperations).values({
          id: operationId,
          changeRequestId,
          baseId: base.id,
          operation: "record_update",
          status: "pending",
          targetRecordId: record.id,
          targetViewId: null,
          sourceRecordId: null,
          sourceCommitId: null,
          baseCommitId: update.baseCommitId ?? record.headCommitId,
          headCommitId: commitId,
          deleteMode: "archive",
          mergedRecordId: null,
          mergedViewId: null,
          position,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await writer
          .update(busabaseCommits)
          .set({ operationId })
          .where(eq(busabaseCommits.id, commitId));
        await projectCommitFields({
          baseId: base.id,
          commitId,
          changeRequestId,
          operationId,
          fields: update.fields,
          tx: writer,
          fieldDefs,
        });
      }
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
        if (existing) return existing;
      }
    }
    throw error;
  }

  try {
    await insertAuditEvent(db, {
      action: "change_request.updated",
      actorId: submittedBy,
      baseId: base.id,
      changeRequestId,
      metadata: {
        operation: "record_update",
        bulk: true,
        recordCount: parsed.updates.length,
      },
    });
  } catch {
    // The proposal ledger is authoritative; audit delivery is best-effort.
  }

  return finalizeChangeRequest({
    changeRequestId,
    nodeId: base.nodeId,
    requestedAutoMerge: parsed.autoMerge,
    submittedBy,
    baseId: base.id,
    label: "bulk record update",
    kind: "content",
  });
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
    throw new ORPCError("CONFLICT", {
      message: `Record is already archived: ${recordId}`,
    });
  }

  const [headCommit] = await db
    .select()
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, record.headCommitId))
    .limit(1);
  if (!headCommit) {
    // Deliberately a 5xx: a record row pointing at a commit that does not exist
    // is a broken invariant, not a request the caller can correct.
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: `Record head commit not found: ${record.headCommitId}`,
    });
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  await insertCommit(db, {
    id: commitId,
    baseId: record.baseId,
    operationId: null,
    parentCommitId: record.headCommitId,
    payload: headCommit.payload,
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
    fields: headCommit.payload,
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
  input: z.infer<typeof updateRecordChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = updateRecordChangeRequestInputSchema.parse(input);
  const submittedBy = resolveActorId(parsed.author);
  const [record] = await db
    .select()
    .from(busabaseRecords)
    .where(and(eq(busabaseRecords.id, recordId), eq(busabaseRecords.spaceId, getContextSpaceId())))
    .limit(1);
  if (!record) {
    throw recordNotFound(recordId);
  }
  if (record.status === "archived") {
    throw new ORPCError("CONFLICT", {
      message: `Record is already archived: ${recordId}`,
    });
  }

  const base = await getBase(record.baseId);
  if (!base) {
    throw baseNotFound(record.baseId);
  }
  await assertBaseChangeRequestPermission(base.id, submittedBy);
  // `parsed.fields` is only the caller's partial delta — an omitted required
  // field means "leave it alone", not "this record has no value for it".
  // Validate against the MERGED view (current committed fields + delta) so the
  // required-check only fires when a field is genuinely missing a value, not
  // merely un-resubmitted. This mirrors mergeRecordUpdate in merge/record.ts,
  // which already merges the same way before persisting; what actually gets
  // stored as the commit's delta (parsed.fields) is untouched by this — only
  // the requiredness CHECK sees the merged fields.
  const [currentCommit] = await db
    .select({ fields: busabaseCommits.payload })
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

  await insertCommit(db, {
    id: commitId,
    baseId: record.baseId,
    operationId: null,
    parentCommitId: record.headCommitId,
    payload: parsed.fields,
    operation: "record_update",
    message: parsed.message,
    author: parsed.author,
    createdAt: timestamp,
  });

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: record.baseId,
    status: "in_review",
    submittedBy,
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
    submittedBy,
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create update changeRequest");
  }
  const autoMerge = shouldAutoMerge(
    parsed.autoMerge,
    await hasNodePermission(base.nodeId, "write", submittedBy),
  );
  if (autoMerge) {
    await reviewChangeRequest(changeRequestId, { verdict: "approved" });
    const merged = await mergeChangeRequest(changeRequestId);
    if (!merged.record) {
      throw new Error("Auto-merge did not produce an updated record");
    }
    return { ...merged.record, materialized: true as const };
  }
  return { ...changeRequest, materialized: false as const };
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
    throw new ORPCError("CONFLICT", { message: `Record is not archived: ${recordId}` });
  }

  const [headCommit] = await db
    .select()
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, record.headCommitId))
    .limit(1);
  if (!headCommit) {
    // Deliberately a 5xx: a record row pointing at a commit that does not exist
    // is a broken invariant, not a request the caller can correct.
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: `Record head commit not found: ${record.headCommitId}`,
    });
  }

  const base = await getBase(record.baseId);
  if (!base) {
    throw baseNotFound(record.baseId);
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();

  await insertCommit(db, {
    id: commitId,
    baseId: record.baseId,
    operationId: null,
    parentCommitId: record.headCommitId,
    payload: headCommit.payload,
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

  await insertCommit(db, {
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    payload: fields,
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
  autoMerge?: boolean,
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
    throw new ORPCError("CONFLICT", {
      message: `Base is not archived: ${baseId}`,
    });
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const fields = { baseId: baseRow.id, slug: baseRow.slug };

  await insertCommit(db, {
    id: commitId,
    baseId: baseRow.id,
    operationId: null,
    parentCommitId: null,
    payload: fields,
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
  return finalizeChangeRequest({
    changeRequestId,
    nodeId: baseRow.nodeId,
    requestedAutoMerge: autoMerge,
    submittedBy,
    baseId: baseRow.id,
    label: "restore base",
    kind: "structural",
  });
};
