import "server-only";

import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId, withContextSourceMeta } from "../../../context";
import { getDb } from "../../../db";
import {
  busabaseChangeRequests,
  busabaseCommits,
  busabaseOperations,
  busabaseViews,
} from "../../../db/schema";
import { insertAuditEvent } from "../../../logic/audit";
import { insertCommit } from "../../../logic/commits";
import {
  getChangeRequest,
  mergeChangeRequest,
  reviewChangeRequest,
} from "../../../logic/cr-lifecycle";
import { id, now } from "../../../logic/kernel";
import { publishChangeRequestPendingReview } from "../../../logic/live-events";
import { hasNodePermission, shouldAutoMerge } from "../../../logic/node-acl";
import { ensureReady } from "../../../logic/seed";
import {
  createViewInputSchema,
  deleteViewInputSchema,
  restoreViewInputSchema,
  updateViewInputSchema,
} from "../../../logic/store";
import { normalizeViewConfig } from "../../../logic/vo";
import { baseNotFound } from "./errors";
import { getBase, listViews } from "./queries";

export {
  createViewInputSchema,
  deleteViewInputSchema,
  restoreViewInputSchema,
  updateViewInputSchema,
};

/** Caller-supplied viewId doesn't resolve (or isn't active) — a genuine "not found" client error. */
const viewNotFound = (viewId: string) =>
  new ORPCError("NOT_FOUND", { message: `View not found: ${viewId}` });

/**
 * Shared tail for all four view proposals: read the change request back and,
 * when the actor may auto-merge, approve + merge it in the same call so the
 * caller gets the materialized View instead of having to poll/approve/merge
 * itself in three separate calls.
 *
 * Node-scoped on purpose (not `reviewChangeRequest`/`mergeChangeRequest`'s own
 * internal workspace-level check), consistent with createBase / createDoc /
 * createFileNode / createFileTreeNode / the record endpoints: an actor
 * restricted by node ACL still can't auto-merge onto a Base they don't hold
 * node-level `write` on.
 */
const finalizeViewChangeRequest = async (args: {
  changeRequestId: string;
  baseId: string;
  baseNodeId: string;
  requestedAutoMerge: boolean | undefined;
  submittedBy: string;
  label: string;
}) => {
  const autoMerge = shouldAutoMerge(
    args.requestedAutoMerge,
    await hasNodePermission(args.baseNodeId, "write", args.submittedBy),
  );

  if (!autoMerge) {
    // Emitted HERE, not at the call sites: a CR that is about to be auto-merged
    // never becomes reviewable, so announcing it as pending review pings a human
    // about work that vanishes microseconds later. Publishing before deciding
    // (which is what the four callers used to do) produced exactly that phantom
    // notification.
    await publishChangeRequestPendingReview({
      spaceId: getContextSpaceId(),
      baseId: args.baseId,
      changeRequestId: args.changeRequestId,
      submittedBy: resolveActorId(args.submittedBy),
    });
    const changeRequest = await getChangeRequest(args.changeRequestId);
    if (!changeRequest) {
      throw new Error(`Failed to create view ${args.label} change request`);
    }
    return { ...changeRequest, materialized: false as const };
  }

  await reviewChangeRequest(args.changeRequestId, { verdict: "approved" });
  const merged = await mergeChangeRequest(args.changeRequestId);
  if (!merged.view) {
    throw new Error(`Auto-merge did not produce a view (${args.label})`);
  }
  return { ...merged.view, materialized: true as const };
};

export const createViewChangeRequest = async (
  baseId: string,
  input: z.input<typeof createViewInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw baseNotFound(baseId);
  }

  const rawParsed = createViewInputSchema.parse(input);
  // Auto-generate slug from name if not provided.
  const autoSlug =
    rawParsed.slug ??
    rawParsed.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const parsed = { ...rawParsed, slug: autoSlug };
  const existingViews = await listViews(base.id);
  if (existingViews.some((view) => view.slug === parsed.slug)) {
    throw new ORPCError("CONFLICT", { message: `View slug already exists: ${parsed.slug}` });
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
    type: parsed.type,
  };

  await insertCommit(db, {
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    payload: fields,
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
    sourceMeta: withContextSourceMeta({ subject: "view", viewSlug: parsed.slug }),
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
  return finalizeViewChangeRequest({
    changeRequestId,
    baseId: base.id,
    baseNodeId: base.nodeId,
    requestedAutoMerge: parsed.autoMerge,
    submittedBy: parsed.submittedBy,
    label: "create",
  });
};

export const createUpdateViewChangeRequest = async (
  viewId: string,
  input: z.input<typeof updateViewInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const [view] = await db
    .select()
    .from(busabaseViews)
    .where(and(eq(busabaseViews.id, viewId), eq(busabaseViews.spaceId, getContextSpaceId())))
    .limit(1);
  if (!view || view.status !== "active") {
    throw viewNotFound(viewId);
  }
  const base = await getBase(view.baseId);
  if (!base) {
    // view.baseId is an internal FK we just resolved the view through, not a
    // client-supplied id — a miss here means the data is inconsistent, not that
    // the caller passed a bad id. Keep as a plain Error (500) to surface the bug.
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
    type: parsed.type ?? view.type,
  };

  await insertCommit(db, {
    id: commitId,
    baseId: view.baseId,
    operationId: null,
    parentCommitId: null,
    payload: fields,
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
    sourceMeta: withContextSourceMeta({ subject: "view", viewId: view.id }),
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
  return finalizeViewChangeRequest({
    changeRequestId,
    baseId: base.id,
    baseNodeId: base.nodeId,
    requestedAutoMerge: parsed.autoMerge,
    submittedBy: parsed.submittedBy,
    label: "update",
  });
};

export const createDeleteViewChangeRequest = async (
  viewId: string,
  input?: z.input<typeof deleteViewInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const [view] = await db
    .select()
    .from(busabaseViews)
    .where(and(eq(busabaseViews.id, viewId), eq(busabaseViews.spaceId, getContextSpaceId())))
    .limit(1);
  if (!view || view.status !== "active") {
    throw viewNotFound(viewId);
  }
  const base = await getBase(view.baseId);
  if (!base) {
    // Internal FK, not client input — see comment in createUpdateViewChangeRequest.
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

  await insertCommit(db, {
    id: commitId,
    baseId: view.baseId,
    operationId: null,
    parentCommitId: null,
    payload: fields,
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
    sourceMeta: withContextSourceMeta({ subject: "view", viewId: view.id }),
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
  return finalizeViewChangeRequest({
    changeRequestId,
    baseId: base.id,
    baseNodeId: base.nodeId,
    requestedAutoMerge: parsed.autoMerge,
    submittedBy: parsed.submittedBy,
    label: "delete",
  });
};

export const createRestoreViewChangeRequest = async (
  viewId: string,
  input?: z.input<typeof restoreViewInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const [view] = await db
    .select()
    .from(busabaseViews)
    .where(and(eq(busabaseViews.id, viewId), eq(busabaseViews.spaceId, getContextSpaceId())))
    .limit(1);
  if (!view) {
    throw viewNotFound(viewId);
  }
  if (view.status !== "archived") {
    throw new Error(`View is not archived: ${viewId}`);
  }
  const base = await getBase(view.baseId);
  if (!base) {
    // Internal FK, not client input — see comment in createUpdateViewChangeRequest.
    throw new Error(`Base not found: ${view.baseId}`);
  }

  const parsed = restoreViewInputSchema.parse(input ?? {});
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

  await insertCommit(db, {
    id: commitId,
    baseId: view.baseId,
    operationId: null,
    parentCommitId: null,
    payload: fields,
    operation: "view_restore",
    message: parsed.message,
    author: parsed.submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: view.baseId,
    status: "in_review",
    submittedBy: resolveActorId(parsed.submittedBy),
    sourceMeta: withContextSourceMeta({ subject: "view", viewId: view.id }),
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
    operation: "view_restore",
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
    action: "change_request.created",
    actorId: parsed.submittedBy,
    baseId: view.baseId,
    changeRequestId,
    commitId,
    operationId,
    metadata: { operation: "view_restore", viewId: view.id },
  });
  return finalizeViewChangeRequest({
    changeRequestId,
    baseId: base.id,
    baseNodeId: base.nodeId,
    requestedAutoMerge: parsed.autoMerge,
    submittedBy: parsed.submittedBy,
    label: "restore",
  });
};
