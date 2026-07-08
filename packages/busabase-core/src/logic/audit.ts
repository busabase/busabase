import "server-only";

import type { CommentSubjectType } from "busabase-contract/types";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getContextSpaceId, resolveActorId, resolveUserRefs } from "../context";
import { getDb } from "../db";
import {
  busabaseAuditEvents,
  busabaseChangeRequests,
  busabaseComments,
  busabaseCommits,
  busabaseOperations,
  busabaseRecords,
} from "../db/schema";
import { CURRENT_USER_ID, id, listInputSchema, now } from "./kernel";
import { toAuditEventVO, toCommentVO } from "./vo";

// ── Schemas ───────────────────────────────────────────────────────────────────
// These are also exported from ./store for backward compat; re-defined here to
// avoid a circular module dependency (store re-exports from audit, audit
// imports from store → cycle).

export const auditEventInputSchema = z.object({
  action: z.enum([
    "record.viewed",
    "change_request.created",
    "change_request.updated",
    "change_request.deleted",
    "change_request.reviewed",
    "change_request.merged",
    // Direct (non-change-request) mutations — kept in sync with the contract's
    // auditActionSchema so bypass operations still leave an audit trail.
    "base.created",
    "field.created",
    "doc.created",
    "doc.updated",
    "file.created",
    "skill.created",
    "drive.created",
    "asset.deleted",
    "asset.metadata_updated",
    "node.purged",
  ]),
  actorId: z.string().optional().default("local-viewer"),
  baseId: z.string().optional().nullable(),
  recordId: z.string().optional().nullable(),
  changeRequestId: z.string().optional().nullable(),
  operationId: z.string().optional().nullable(),
  commitId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const commentSubjectInputSchema = z.object({
  subjectType: z.enum(["record", "change_request", "operation", "commit"]),
  subjectId: z.string().min(1),
});

export const createCommentInputSchema = commentSubjectInputSchema.extend({
  authorId: z.string().optional().default(CURRENT_USER_ID),
  body: z.string().trim().min(1),
  mentionsAi: z.boolean().optional().default(false),
});

export { listInputSchema };

const liveChangeRequestAuditActions = [
  "change_request.created",
  "change_request.updated",
  "change_request.deleted",
  "change_request.reviewed",
] as const;

type LiveChangeRequestAuditAction = (typeof liveChangeRequestAuditActions)[number];

const isLiveChangeRequestAuditAction = (action: string): action is LiveChangeRequestAuditAction =>
  (liveChangeRequestAuditActions as readonly string[]).includes(action);

// ── Logic ─────────────────────────────────────────────────────────────────────

export const insertAuditEvent = async (
  db: Awaited<ReturnType<typeof getDb>>,
  input: z.input<typeof auditEventInputSchema>,
) => {
  const parsed = auditEventInputSchema.parse(input);
  const [event] = await db
    .insert(busabaseAuditEvents)
    .values({
      id: id("aud"),
      action: parsed.action,
      actorId: resolveActorId(parsed.actorId),
      baseId: parsed.baseId ?? null,
      recordId: parsed.recordId ?? null,
      changeRequestId: parsed.changeRequestId ?? null,
      operationId: parsed.operationId ?? null,
      commitId: parsed.commitId ?? null,
      metadata: parsed.metadata,
      createdAt: now(),
    })
    .returning();
  const eventVO = toAuditEventVO(event, await resolveUserRefs([event.actorId]));

  if (event.changeRequestId && isLiveChangeRequestAuditAction(event.action)) {
    const { publishBusabaseLiveEvent } = await import("./live-events");
    await publishBusabaseLiveEvent({
      kind: event.action,
      spaceId: getContextSpaceId(),
      actorId: event.actorId,
      changeRequestId: event.changeRequestId,
      baseId: event.baseId,
      nodeIds: [],
      recordIds: event.recordId ? [event.recordId] : [],
      viewIds: [],
      operationCount: 0,
    });
  }

  return eventVO;
};

const resolveCommentSubject = async (
  db: Awaited<ReturnType<typeof getDb>>,
  subjectType: CommentSubjectType,
  subjectId: string,
  spaceId: string,
) => {
  if (subjectType === "record") {
    const [record] = await db
      .select()
      .from(busabaseRecords)
      .where(and(eq(busabaseRecords.id, subjectId), eq(busabaseRecords.spaceId, spaceId)))
      .limit(1);
    if (!record) {
      throw new Error(`Record not found: ${subjectId}`);
    }
    return {
      commitId: record.headCommitId,
      changeRequestId: null,
      operationId: null,
      recordId: record.id,
    };
  }

  if (subjectType === "change_request") {
    const [changeRequest] = await db
      .select()
      .from(busabaseChangeRequests)
      .where(
        and(eq(busabaseChangeRequests.id, subjectId), eq(busabaseChangeRequests.spaceId, spaceId)),
      )
      .limit(1);
    if (!changeRequest) {
      throw new Error(`ChangeRequest not found: ${subjectId}`);
    }
    return {
      commitId: null,
      changeRequestId: changeRequest.id,
      operationId: null,
      recordId: null,
    };
  }

  if (subjectType === "operation") {
    const [operation] = await db
      .select()
      .from(busabaseOperations)
      .where(and(eq(busabaseOperations.id, subjectId), eq(busabaseOperations.spaceId, spaceId)))
      .limit(1);
    if (!operation) {
      throw new Error(`Operation not found: ${subjectId}`);
    }
    return {
      commitId: operation.headCommitId,
      changeRequestId: operation.changeRequestId,
      operationId: operation.id,
      recordId: operation.targetRecordId ?? operation.mergedRecordId,
    };
  }

  const [commit] = await db
    .select()
    .from(busabaseCommits)
    .where(and(eq(busabaseCommits.id, subjectId), eq(busabaseCommits.spaceId, spaceId)))
    .limit(1);
  if (!commit) {
    throw new Error(`Commit not found: ${subjectId}`);
  }
  return {
    commitId: commit.id,
    changeRequestId: null,
    operationId: commit.operationId,
    recordId: null,
  };
};

export const createAuditEvent = async (input: z.infer<typeof auditEventInputSchema>) => {
  const { ensureReady } = await import("./seed");
  await ensureReady();
  const db = await getDb();
  return insertAuditEvent(db, input);
};

export const listAuditEvents = async (input?: z.input<typeof listInputSchema>) => {
  const { ensureReady } = await import("./seed");
  await ensureReady();
  const db = await getDb();
  const parsed = listInputSchema.parse(input);
  const events = await db
    .select()
    .from(busabaseAuditEvents)
    .where(eq(busabaseAuditEvents.spaceId, getContextSpaceId()))
    .orderBy(desc(busabaseAuditEvents.createdAt))
    .limit(parsed.limit);
  const users = await resolveUserRefs(events.map((event) => event.actorId));
  return events.map((event) => toAuditEventVO(event, users));
};

export const listComments = async (input: z.infer<typeof commentSubjectInputSchema>) => {
  const { ensureReady } = await import("./seed");
  await ensureReady();
  const db = await getDb();
  const parsed = commentSubjectInputSchema.parse(input);
  const comments = await db
    .select()
    .from(busabaseComments)
    .where(
      and(
        eq(busabaseComments.spaceId, getContextSpaceId()),
        eq(busabaseComments.subjectType, parsed.subjectType),
        eq(busabaseComments.subjectId, parsed.subjectId),
      ),
    )
    .orderBy(asc(busabaseComments.createdAt));
  const users = await resolveUserRefs(comments.map((comment) => comment.authorId));
  return comments.map((comment) => toCommentVO(comment, users));
};

export const createComment = async (input: z.infer<typeof createCommentInputSchema>) => {
  const { ensureReady } = await import("./seed");
  await ensureReady();
  const db = await getDb();
  const parsed = createCommentInputSchema.parse(input);
  const subjectLinks = await resolveCommentSubject(
    db,
    parsed.subjectType,
    parsed.subjectId,
    getContextSpaceId(),
  );
  const timestamp = now();
  const [comment] = await db
    .insert(busabaseComments)
    .values({
      id: id("com"),
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      recordId: subjectLinks.recordId,
      changeRequestId: subjectLinks.changeRequestId,
      operationId: subjectLinks.operationId,
      commitId: subjectLinks.commitId,
      authorId: resolveActorId(parsed.authorId),
      body: parsed.body,
      mentionsAi: parsed.mentionsAi,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  if (parsed.mentionsAi && subjectLinks.changeRequestId) {
    const { notifyAgentOfChangeRequest } = await import("./cr-lifecycle");
    notifyAgentOfChangeRequest(subjectLinks.changeRequestId, "ai_mention");
  }
  return toCommentVO(comment, await resolveUserRefs([comment.authorId]));
};
