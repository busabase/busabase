import "server-only";

/**
 * The Inbox's Mentions tab — the read half of `@`-mentioning a teammate.
 *
 * The write half (PR #6981) already records every mention in
 * `busabase_comment_mentions` with a nullable `readAt`, and deliberately
 * pre-stamps `readAt` on a self-mention. That table IS the notification
 * record; this module only reads it. There is no notifications table, no
 * bell, and no schema change here — see `ai-mention-agent-integration.md`
 * §7.6 for why that was the design rather than an omission.
 */

import type { CommentSubjectType, UserRefVO } from "busabase-contract/types";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getContextSpaceId, resolveActorId, resolveUserRefs } from "../context";
import type { getDb } from "../db";
import { busabaseCommentMentions, busabaseComments } from "../db/schema";
import { busabaseBases, busabaseRecords } from "../domains/base/schema";
import { CURRENT_USER_ID, now } from "./kernel";

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Who "me" is for this inbox.
 *
 * `resolveActorId` returns the host-injected actor when there is one and falls
 * back to its argument otherwise — and the open-source single-user host
 * injects nothing. Passing `""` there would make the inbox belong to nobody,
 * so the fallback has to be the same `CURRENT_USER_ID` that `createComment`
 * defaults `authorId` to. If the two disagreed, a local user would write
 * mentions as `local-admin` and then read an inbox belonging to someone else —
 * which is exactly what the first live run of this code did.
 */
const currentActorId = () => resolveActorId(CURRENT_USER_ID);

export interface MentionInboxItem {
  commentId: string;
  subjectType: CommentSubjectType;
  body: string;
  authorId: string;
  author: UserRefVO | null;
  createdAt: string;
  unread: boolean;
  href: string | null;
}

export interface MentionInboxPage {
  items: MentionInboxItem[];
  total: number;
  unreadCount: number;
}

/**
 * Where a mention row sends you.
 *
 * `change_request` and `operation` both live on a change request page, so both
 * key off `changeRequestId` rather than `subjectType` — an operation-scoped
 * comment whose CR is gone has nowhere better to go than nowhere.
 *
 * `commit` has no destination at all: the dashboard has no commit detail
 * route. It still returns a row with `href: null` rather than being filtered
 * out. Dropping it would mean the one case where being mentioned silently
 * fails to reach you, which is the exact failure this whole feature exists to
 * end — a row you cannot click still tells you someone wants your attention.
 */
const hrefFor = (
  subjectType: CommentSubjectType,
  subjectId: string,
  changeRequestId: string | null,
  recordLocation: { baseSlug: string; recordId: string } | undefined,
): string | null => {
  if (subjectType === "operation" && changeRequestId) {
    return `/inbox/${changeRequestId}/${subjectId}`;
  }
  if (changeRequestId) return `/inbox/${changeRequestId}`;
  if (subjectType === "record" && recordLocation) {
    return `/base/${recordLocation.baseSlug}/${recordLocation.recordId}`;
  }
  return null;
};

/**
 * Comment ids this actor is mentioned in, newest first.
 *
 * Grouped by comment, not by mention row: being named twice in one comment is
 * legitimate (each span renders its own chip) but it is still one thing to go
 * read. `MAX(created_at)` orders groups by their newest row, and
 * `bool_or(read_at IS NULL)` makes a comment unread while ANY of its mentions
 * is — reading it clears them all together, so the two agree.
 */
const listMentionedCommentIds = async (
  db: Db,
  actorId: string,
  spaceId: string,
  limit: number,
  offset: number,
) => {
  const rows = await db
    .select({
      commentId: busabaseCommentMentions.commentId,
      unread: sql<boolean>`bool_or(${busabaseCommentMentions.readAt} is null)`,
      newest: sql<Date>`max(${busabaseCommentMentions.createdAt})`,
    })
    .from(busabaseCommentMentions)
    .innerJoin(busabaseComments, eq(busabaseComments.id, busabaseCommentMentions.commentId))
    .where(
      and(
        eq(busabaseCommentMentions.targetType, "member"),
        eq(busabaseCommentMentions.targetId, actorId),
        eq(busabaseComments.spaceId, spaceId),
      ),
    )
    .groupBy(busabaseCommentMentions.commentId)
    .orderBy(desc(sql`max(${busabaseCommentMentions.createdAt})`))
    .limit(limit)
    .offset(offset);
  return rows;
};

/** Distinct comments with at least one unread mention — the tab badge. */
export const countUnreadMentions = async (
  db: Db,
  actorId: string,
  spaceId: string,
): Promise<number> => {
  const [row] = await db
    .select({
      count: sql<number>`count(distinct ${busabaseCommentMentions.commentId})::int`,
    })
    .from(busabaseCommentMentions)
    .innerJoin(busabaseComments, eq(busabaseComments.id, busabaseCommentMentions.commentId))
    .where(
      and(
        eq(busabaseCommentMentions.targetType, "member"),
        eq(busabaseCommentMentions.targetId, actorId),
        eq(busabaseComments.spaceId, spaceId),
        isNull(busabaseCommentMentions.readAt),
      ),
    );
  return row?.count ?? 0;
};

const countMentionedComments = async (db: Db, actorId: string, spaceId: string) => {
  const [row] = await db
    .select({
      count: sql<number>`count(distinct ${busabaseCommentMentions.commentId})::int`,
    })
    .from(busabaseCommentMentions)
    .innerJoin(busabaseComments, eq(busabaseComments.id, busabaseCommentMentions.commentId))
    .where(
      and(
        eq(busabaseCommentMentions.targetType, "member"),
        eq(busabaseCommentMentions.targetId, actorId),
        eq(busabaseComments.spaceId, spaceId),
      ),
    );
  return row?.count ?? 0;
};

/**
 * One page of the caller's mentions.
 *
 * Always the caller's: the actor comes from context, never from input. A
 * mention inbox that accepted a user id would be a way to read the workspace's
 * comments by proxy.
 */
export const listMentionInbox = async (
  db: Db,
  input: { page: number; pageSize: number },
): Promise<MentionInboxPage> => {
  const actorId = currentActorId();
  const spaceId = getContextSpaceId();
  const offset = (input.page - 1) * input.pageSize;

  const grouped = await listMentionedCommentIds(db, actorId, spaceId, input.pageSize, offset);
  const [total, unreadCount] = await Promise.all([
    countMentionedComments(db, actorId, spaceId),
    countUnreadMentions(db, actorId, spaceId),
  ]);
  if (grouped.length === 0) return { items: [], total, unreadCount };

  const commentIds = grouped.map((row) => row.commentId);
  const comments = await db
    .select()
    .from(busabaseComments)
    .where(inArray(busabaseComments.id, commentIds));
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));

  // A record-scoped comment links to `/base/{slug}/{recordId}`, which needs the
  // base's slug — the comment only carries the record id. One batched lookup
  // rather than one per row.
  const recordIds = comments.map((comment) => comment.recordId).filter((v): v is string => !!v);
  const recordLocations = new Map<string, { baseSlug: string; recordId: string }>();
  if (recordIds.length > 0) {
    const rows = await db
      .select({ recordId: busabaseRecords.id, baseSlug: busabaseBases.slug })
      .from(busabaseRecords)
      .innerJoin(busabaseBases, eq(busabaseBases.id, busabaseRecords.baseId))
      .where(inArray(busabaseRecords.id, recordIds));
    for (const row of rows) {
      recordLocations.set(row.recordId, { baseSlug: row.baseSlug, recordId: row.recordId });
    }
  }

  const users = await resolveUserRefs(comments.map((comment) => comment.authorId));

  const items: MentionInboxItem[] = [];
  for (const row of grouped) {
    const comment = commentById.get(row.commentId);
    if (!comment) continue;
    items.push({
      commentId: comment.id,
      subjectType: comment.subjectType as CommentSubjectType,
      body: comment.body,
      authorId: comment.authorId,
      author: users.get(comment.authorId) ?? null,
      createdAt: comment.createdAt.toISOString(),
      unread: row.unread,
      href: hrefFor(
        comment.subjectType as CommentSubjectType,
        comment.subjectId,
        comment.changeRequestId,
        comment.recordId ? recordLocations.get(comment.recordId) : undefined,
      ),
    });
  }
  return { items, total, unreadCount };
};

/**
 * Stamp every unread mention this caller has on one comment.
 *
 * ALL of them, not one: a comment that named you twice produced two rows but
 * is a single entry in the list, so clearing one and leaving the other would
 * leave the badge counting a comment the user has already read.
 */
export const markMentionsRead = async (
  db: Db,
  input: { commentId: string },
): Promise<{ marked: number; unreadCount: number }> => {
  const actorId = currentActorId();
  const spaceId = getContextSpaceId();

  // Scope the write through the comment's space so a caller cannot stamp rows
  // on a comment outside the space they are acting in.
  const [comment] = await db
    .select({ id: busabaseComments.id })
    .from(busabaseComments)
    .where(and(eq(busabaseComments.id, input.commentId), eq(busabaseComments.spaceId, spaceId)))
    .limit(1);
  if (!comment) {
    return { marked: 0, unreadCount: await countUnreadMentions(db, actorId, spaceId) };
  }

  const stamped = await db
    .update(busabaseCommentMentions)
    .set({ readAt: now() })
    .where(
      and(
        eq(busabaseCommentMentions.commentId, input.commentId),
        eq(busabaseCommentMentions.targetType, "member"),
        eq(busabaseCommentMentions.targetId, actorId),
        isNull(busabaseCommentMentions.readAt),
      ),
    )
    .returning();

  return {
    marked: stamped.length,
    unreadCount: await countUnreadMentions(db, actorId, spaceId),
  };
};
