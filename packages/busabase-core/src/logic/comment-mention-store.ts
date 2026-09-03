import "server-only";

/**
 * Structured comment mentions — the server half: persistence, label resolution
 * and agent dispatch.
 *
 * The pure span math lives next door in `comment-mentions.ts` so it can be
 * exercised without a database; everything here needs `db`, the actor, or the
 * agents domain.
 */

import type { CommentMentionVO, CommentSubjectType, UserRefVO } from "busabase-contract/types";
import { asc, eq, inArray } from "drizzle-orm";
import { resolveUserRefs } from "../context";
import type { getDb } from "../db";
import { busabaseCommentMentions, type CommentMentionPO } from "../db/schema";
import {
  buildMentionPrompt,
  type MentionPromptSubject,
  type NormalizedCommentMention,
  truncateMentionError,
} from "./comment-mentions";
import { id, now } from "./kernel";

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Display name for a mentioned member.
 *
 * Deliberately NOT the dashboard's `formatUserRefLabel`: that helper is
 * locale-aware and belongs to the UI layer, while a VO label crosses the wire
 * to clients in four locales. Name → email → raw id keeps the server's answer
 * locale-free and lets the client localize its own fallback if it wants one.
 */
const memberLabel = (user: UserRefVO | undefined, targetId: string): string =>
  user?.name?.trim() || user?.email?.trim() || targetId;

/**
 * Persist the validated spans for a freshly created comment.
 *
 * Agent rows land as `queued` — they have been accepted but no session exists
 * yet, and `dispatchAgentMentions` is what moves them on. Member rows are
 * `not_applicable`: a person is not dispatched to.
 *
 * A **self-mention is written with `readAt` already stamped**. The chip must
 * still render (you mentioned yourself on purpose), but it must never inflate
 * your own unread count — that is the difference between a delivery record and
 * a display record, and it is cheaper to get right at write time than to
 * special-case in every future read.
 */
export const insertCommentMentions = async (
  db: Db,
  input: {
    commentId: string;
    authorId: string;
    mentions: readonly NormalizedCommentMention[];
  },
): Promise<CommentMentionPO[]> => {
  if (input.mentions.length === 0) return [];
  const timestamp = now();
  const rows = input.mentions.map((mention) => ({
    id: id("cmn"),
    commentId: input.commentId,
    targetType: mention.type,
    targetId: mention.targetId,
    startOffset: mention.start,
    endOffset: mention.end,
    label: null,
    dispatchStatus: mention.type === "agent" ? ("queued" as const) : ("not_applicable" as const),
    sessionId: null,
    error: null,
    readAt: mention.type === "member" && mention.targetId === input.authorId ? timestamp : null,
    createdAt: timestamp,
  }));
  return await db.insert(busabaseCommentMentions).values(rows).returning();
};

/** Every mention row for these comments, ordered so chips render left to right. */
export const loadCommentMentions = async (
  db: Db,
  commentIds: readonly string[],
): Promise<Map<string, CommentMentionPO[]>> => {
  const byComment = new Map<string, CommentMentionPO[]>();
  if (commentIds.length === 0) return byComment;
  const rows = await db
    .select()
    .from(busabaseCommentMentions)
    .where(inArray(busabaseCommentMentions.commentId, [...new Set(commentIds)]))
    .orderBy(asc(busabaseCommentMentions.startOffset));
  for (const row of rows) {
    const list = byComment.get(row.commentId) ?? [];
    list.push(row);
    byComment.set(row.commentId, list);
  }
  return byComment;
};

/**
 * Turn mention rows into VOs, resolving labels server-side.
 *
 * Member labels re-resolve live from the identity map (a renamed teammate shows
 * their current name); agent labels use the snapshot taken when the session was
 * created, because re-deriving them would mean probing the machine for agent
 * binaries on every comment read. Both fall back to the raw target id rather
 * than to anything the client sent — a client-supplied label is never identity.
 */
export const toCommentMentionVOs = (
  rows: readonly CommentMentionPO[],
  users?: Map<string, UserRefVO>,
): CommentMentionVO[] =>
  rows.map((row) => ({
    id: row.id,
    type: row.targetType,
    targetId: row.targetId,
    label:
      row.targetType === "member"
        ? memberLabel(users?.get(row.targetId), row.targetId)
        : (row.label ?? row.targetId),
    start: row.startOffset,
    end: row.endOffset,
    dispatchStatus: row.dispatchStatus,
    sessionId: row.sessionId,
    error: row.error,
  }));

/** Member ids referenced by these rows, for a single batched `resolveUserRefs`. */
export const mentionMemberIds = (rows: readonly CommentMentionPO[]): string[] =>
  rows.filter((row) => row.targetType === "member").map((row) => row.targetId);

// ── Agent dispatch ────────────────────────────────────────────────────────────

const CONTEXT_MAX_LENGTH = 12_000;

const clampContext = (text: string): string =>
  text.length <= CONTEXT_MAX_LENGTH ? text : `${text.slice(0, CONTEXT_MAX_LENGTH)}\n… (truncated)`;

/**
 * Describe the commented-on subject for the agent.
 *
 * `change_request` and `operation` are the two subjects the P0 mention picker
 * is wired into, so they get real content. `record`/`commit` deliberately get
 * only their identity for now: inventing a half-accurate record snapshot here
 * would be worse than telling the agent exactly what we know, and the real
 * snapshot is P1's job.
 */
const describeMentionSubject = async (
  subjectType: CommentSubjectType,
  subjectId: string,
  changeRequestId: string | null,
): Promise<MentionPromptSubject> => {
  if (changeRequestId) {
    const { getChangeRequest } = await import("./cr-lifecycle");
    const changeRequest = await getChangeRequest(changeRequestId);
    if (changeRequest) {
      const title = changeRequest.primaryOperation?.headCommit.message?.trim() || changeRequest.id;
      const operations = changeRequest.operations.map((operation) => {
        const target =
          operation.filePath ??
          operation.targetRecordId ??
          operation.targetViewId ??
          operation.nodeId ??
          "—";
        const payload = JSON.stringify(operation.headCommit.payload ?? {});
        return `- ${operation.operation} on ${target}\n  before: ${JSON.stringify(operation.baseFields ?? null)}\n  after:  ${payload}`;
      });
      const focus =
        subjectType === "operation" ? `\nThe comment is on operation ${subjectId}.` : "";
      return {
        kind: "Change Request",
        id: changeRequest.id,
        title,
        context: clampContext(
          `Status: ${changeRequest.status}${focus}\n\n${operations.join("\n")}`,
        ),
      };
    }
  }
  return {
    kind: subjectType === "record" ? "Record" : subjectType === "commit" ? "Commit" : "Subject",
    id: subjectId,
    title: subjectId,
    context: "",
  };
};

/**
 * Start one agent session per agent mention, then hand it the prompt.
 *
 * Two calls, two deliberately different modes — this is the part that hangs the
 * whole product if it is written the obvious way:
 *
 * - **`createAgentSession` IS awaited.** It resolves the launch, registers the
 *   session and returns; the connection handshake continues on `session.ready`
 *   in the background. Awaiting it is cheap and is what yields the `sessionId`
 *   to store on the mention row.
 * - **`promptAgentSession` is NEVER awaited.** Its promise resolves only when
 *   the *entire agent turn* finishes, and it parks indefinitely on a
 *   `session/request_permission` waiting for a human to click a button.
 *   Awaiting it would hold the create-comment HTTP response open for minutes or
 *   forever. Fire it and let the session's own state machine own the outcome —
 *   a prompt failure already flips the session to `failed`, which the inline
 *   status strip derives live.
 *
 * Dispatch happens AFTER the comment and its mention rows are committed. A
 * failure here marks the row `failed`; it never rolls back or errors the
 * comment the user already wrote.
 */
export const dispatchAgentMentions = async (
  db: Db,
  input: {
    commentId: string;
    body: string;
    authorId: string;
    spaceId: string;
    subjectType: CommentSubjectType;
    subjectId: string;
    changeRequestId: string | null;
    rows: readonly CommentMentionPO[];
  },
): Promise<CommentMentionPO[]> => {
  const agentRows = input.rows.filter((row) => row.targetType === "agent");
  if (agentRows.length === 0) return [...input.rows];

  const { createAgentSession, promptAgentSession } = await import(
    "../domains/agents/logic/agent-session-manager"
  );

  const subject = await describeMentionSubject(
    input.subjectType,
    input.subjectId,
    input.changeRequestId,
  );
  const users = await resolveUserRefs([input.authorId]);
  const prompt = buildMentionPrompt({
    subject,
    authorLabel: memberLabel(users.get(input.authorId), input.authorId),
    body: input.body,
  });

  const updated = new Map<string, CommentMentionPO>();
  for (const row of agentRows) {
    try {
      const session = await createAgentSession({ slug: row.targetId, spaceId: input.spaceId });
      const [linked] = await db
        .update(busabaseCommentMentions)
        .set({ dispatchStatus: "linked", sessionId: session.id, label: session.agentName })
        .where(eq(busabaseCommentMentions.id, row.id))
        .returning();
      if (linked) updated.set(linked.id, linked);
      // Fire-and-forget on purpose — see the doc comment above.
      void promptAgentSession(session.id, prompt).catch((error: unknown) => {
        console.warn(
          `[busabase] mention prompt failed for session ${session.id}`,
          error instanceof Error ? error.message : error,
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const [failed] = await db
        .update(busabaseCommentMentions)
        .set({ dispatchStatus: "failed", error: truncateMentionError(message) })
        .where(eq(busabaseCommentMentions.id, row.id))
        .returning();
      if (failed) updated.set(failed.id, failed);
    }
  }

  return input.rows.map((row) => updated.get(row.id) ?? row);
};
