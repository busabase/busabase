import "server-only";

import { ORPCError } from "@orpc/server";
import type { CommentSubjectType } from "busabase-contract/types";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  getContextIsSpaceManager,
  getContextSourceProvenance,
  getContextSpaceId,
  resolveActorId,
  resolveUserRefs,
  withContextSourceMeta,
} from "../context";
import { getDb } from "../db";
import {
  busabaseAuditEvents,
  busabaseBases,
  busabaseChangeRequests,
  busabaseComments,
  busabaseCommits,
  busabaseOperations,
  busabaseRecords,
} from "../db/schema";
import { CURRENT_USER_ID, id, listInputSchema, now } from "./kernel";
import { assertNodePermission, assertWorkspacePermission } from "./node-acl";
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
    "airapp.created",
    "asset.deleted",
    "asset.metadata_updated",
    "asset.text_written",
    "asset.text_marked_none",
    "node.metadata_updated",
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const withAuditSourceMeta = (metadata: Record<string, unknown>) => {
  if (!getContextSourceProvenance()) return metadata;
  const sourceMeta = isRecord(metadata.sourceMeta) ? metadata.sourceMeta : {};
  return { ...metadata, sourceMeta: withContextSourceMeta(sourceMeta) };
};

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
      metadata: withAuditSourceMeta(parsed.metadata),
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

/** Caller-supplied comment subjectId doesn't resolve within the current space —
 *  a genuine "not found" client error (they're commenting on something that
 *  doesn't exist or they can't see). */
const commentSubjectNotFound = (kind: string, subjectId: string) =>
  new ORPCError("NOT_FOUND", { message: `${kind} not found: ${subjectId}` });

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
      throw commentSubjectNotFound("Record", subjectId);
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
      throw commentSubjectNotFound("ChangeRequest", subjectId);
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
      throw commentSubjectNotFound("Operation", subjectId);
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
    throw commentSubjectNotFound("Commit", subjectId);
  }
  return {
    commitId: commit.id,
    changeRequestId: null,
    operationId: commit.operationId,
    recordId: null,
  };
};

export interface AuditSubjectRef {
  baseId?: string | null;
  recordId?: string | null;
  changeRequestId?: string | null;
  operationId?: string | null;
  commitId?: string | null;
}

export const isAuditVisibilityMiss = (error: unknown): boolean =>
  error instanceof ORPCError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN");

/** Resolve an audit/comment subject to its ACL-owning node without leaking IDs. */
export const assertAuditSubjectPermission = async (
  subject: AuditSubjectRef,
  required: "read" | "changeRequest" | "write" | "manage",
): Promise<void> => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  if (
    !subject.baseId &&
    !subject.recordId &&
    !subject.changeRequestId &&
    !subject.operationId &&
    !subject.commitId
  ) {
    if (required === "read") {
      if (!getContextIsSpaceManager()) {
        throw new ORPCError("FORBIDDEN", { message: "Requires manage workspace access" });
      }
      return;
    }
    // A subject-less event has no node to derive authority from, so writing one
    // is a workspace-wide act — manager-only. `manage`, not `required`: a
    // `member`'s workspace baseline is `write`, and it must not double as
    // "manager" here (same reasoning as `assertCanApproveChangeRequest`).
    assertWorkspacePermission("manage");
    return;
  }
  if (subject.changeRequestId) {
    const { assertChangeRequestPermission } = await import("./cr-lifecycle");
    await assertChangeRequestPermission(subject.changeRequestId, required);
    return;
  }
  if (subject.operationId || subject.commitId) {
    const commitId = subject.commitId;
    const [operation] = subject.operationId
      ? await db
          .select({ changeRequestId: busabaseOperations.changeRequestId })
          .from(busabaseOperations)
          .where(
            and(
              eq(busabaseOperations.id, subject.operationId),
              eq(busabaseOperations.spaceId, spaceId),
            ),
          )
          .limit(1)
      : commitId
        ? await db
            .select({ changeRequestId: busabaseOperations.changeRequestId })
            .from(busabaseCommits)
            .innerJoin(busabaseOperations, eq(busabaseOperations.id, busabaseCommits.operationId))
            .where(and(eq(busabaseCommits.id, commitId), eq(busabaseCommits.spaceId, spaceId)))
            .limit(1)
        : [];
    if (!operation) {
      // No owning operation. For a RECORD subject that is normal, not missing:
      // the seeder writes commits directly with no operation row, so every
      // seeded record used to be un-commentable and the error named its commit
      // id ("Subject not found: cmt_…") for a record that plainly exists. Fall
      // through to the record -> Base -> node scoping below, which is the same
      // permission the record's own reads and writes already go through — the
      // CR lookup is a narrowing convenience, not the authority.
      //
      // Only for records: an operation/commit subject with no operation really is
      // dangling, and there is nothing else to scope it by.
      if (!subject.recordId) {
        throw commentSubjectNotFound("Subject", subject.operationId ?? commitId ?? "unknown");
      }
    } else {
      const { assertChangeRequestPermission } = await import("./cr-lifecycle");
      await assertChangeRequestPermission(operation.changeRequestId, required);
      return;
    }
  }
  const [base] = subject.recordId
    ? await db
        .select({ nodeId: busabaseBases.nodeId })
        .from(busabaseRecords)
        .innerJoin(busabaseBases, eq(busabaseBases.id, busabaseRecords.baseId))
        .where(and(eq(busabaseRecords.id, subject.recordId), eq(busabaseRecords.spaceId, spaceId)))
        .limit(1)
    : subject.baseId
      ? await db
          .select({ nodeId: busabaseBases.nodeId })
          .from(busabaseBases)
          .where(and(eq(busabaseBases.id, subject.baseId), eq(busabaseBases.spaceId, spaceId)))
          .limit(1)
      : [];
  if (!base)
    throw commentSubjectNotFound("Subject", subject.recordId ?? subject.baseId ?? "unknown");
  await assertNodePermission(base.nodeId, required);
};

export const createAuditEvent = async (input: z.infer<typeof auditEventInputSchema>) => {
  const { ensureReady } = await import("./seed");
  await ensureReady();
  const db = await getDb();
  await assertAuditSubjectPermission(input, "write");
  return insertAuditEvent(db, input);
};

const listVisibleChangeRequestIds = async (
  candidates: (typeof busabaseAuditEvents.$inferSelect)[],
): Promise<Set<string>> => {
  const changeRequestIds = [
    ...new Set(
      candidates.flatMap((event) => (event.changeRequestId ? [event.changeRequestId] : [])),
    ),
  ];
  if (changeRequestIds.length === 0) return new Set();

  const db = await getDb();
  const rows = await db
    .select({ id: busabaseChangeRequests.id })
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.spaceId, getContextSpaceId()),
        inArray(busabaseChangeRequests.id, changeRequestIds),
      ),
    );
  const { filterVisibleChangeRequestRows } = await import("./cr-lifecycle");
  return new Set((await filterVisibleChangeRequestRows(rows)).map((row) => row.id));
};

export const listAuditEvents = async (input?: z.input<typeof listInputSchema>) => {
  const { ensureReady } = await import("./seed");
  await ensureReady();
  const db = await getDb();
  const parsed = listInputSchema.parse(input);
  const events: (typeof busabaseAuditEvents.$inferSelect)[] = [];
  const batchSize = Math.max(parsed.limit, 20);
  let offset = 0;
  for (;;) {
    const candidates = await db
      .select()
      .from(busabaseAuditEvents)
      .where(eq(busabaseAuditEvents.spaceId, getContextSpaceId()))
      .orderBy(desc(busabaseAuditEvents.createdAt), desc(busabaseAuditEvents.id))
      .limit(batchSize)
      .offset(offset);
    const visibleChangeRequestIds = await listVisibleChangeRequestIds(candidates);
    const visibility = await Promise.all(
      candidates.map(async (event) => {
        if (event.changeRequestId) {
          return visibleChangeRequestIds.has(event.changeRequestId);
        }
        try {
          await assertAuditSubjectPermission(event, "read");
          return true;
        } catch (error) {
          if (isAuditVisibilityMiss(error)) return false;
          throw error;
        }
      }),
    );
    events.push(...candidates.filter((_, index) => visibility[index]));
    if (events.length >= parsed.limit || candidates.length < batchSize) break;
    offset += candidates.length;
  }
  events.splice(parsed.limit);
  const users = await resolveUserRefs(events.map((event) => event.actorId));
  return events.map((event) => toAuditEventVO(event, users));
};

export const listComments = async (input: z.infer<typeof commentSubjectInputSchema>) => {
  const { ensureReady } = await import("./seed");
  await ensureReady();
  const db = await getDb();
  const parsed = commentSubjectInputSchema.parse(input);
  const subjectLinks = await resolveCommentSubject(
    db,
    parsed.subjectType,
    parsed.subjectId,
    getContextSpaceId(),
  );
  await assertAuditSubjectPermission(subjectLinks, "read");
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

// `z.input`, not `z.infer`: `mentionsAi` has `.optional().default(false)`, so the
// inferred OUTPUT type makes it required while callers legitimately omit it.
// `.parse()` below fills the default in. Matches `createDoc`/`createBase`.
export const createComment = async (input: z.input<typeof createCommentInputSchema>) => {
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
  await assertAuditSubjectPermission(subjectLinks, "write");
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
