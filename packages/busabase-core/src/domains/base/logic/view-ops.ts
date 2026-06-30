import "server-only";

import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId } from "../../../context";
import { getDb } from "../../../db";
import {
  busabaseChangeRequests,
  busabaseCommits,
  busabaseOperations,
  busabaseViews,
} from "../../../db/schema";
import { insertAuditEvent } from "../../../logic/audit";
import { getChangeRequest } from "../../../logic/cr-lifecycle";
import { id, now } from "../../../logic/kernel";
import { ensureReady } from "../../../logic/seed";
import {
  createViewInputSchema,
  deleteViewInputSchema,
  restoreViewInputSchema,
  updateViewInputSchema,
} from "../../../logic/store";
import { normalizeViewConfig } from "../../../logic/vo";
import { getBase, listViews } from "./queries";

export {
  createViewInputSchema,
  deleteViewInputSchema,
  restoreViewInputSchema,
  updateViewInputSchema,
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
  const [view] = await db
    .select()
    .from(busabaseViews)
    .where(and(eq(busabaseViews.id, viewId), eq(busabaseViews.spaceId, getContextSpaceId())))
    .limit(1);
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
  const [view] = await db
    .select()
    .from(busabaseViews)
    .where(and(eq(busabaseViews.id, viewId), eq(busabaseViews.spaceId, getContextSpaceId())))
    .limit(1);
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
    throw new Error(`View not found: ${viewId}`);
  }
  if (view.status !== "archived") {
    throw new Error(`View is not archived: ${viewId}`);
  }
  const base = await getBase(view.baseId);
  if (!base) {
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

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: view.baseId,
    operationId: null,
    parentCommitId: null,
    fields,
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

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create view restore change request");
  }
  return changeRequest;
};
