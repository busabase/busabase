/**
 * Structured comment mentions — the pure half.
 *
 * Deliberately free of `server-only`, `~/db`, react and every transport: span
 * validation is the piece that has to agree between the composer (which grows
 * and shrinks spans as the user types) and the server (which refuses anything
 * that does not line up), so it must be runnable from either side and unit
 * testable without a database.
 *
 * Why spans at all, instead of regexing the stored body: `@ai` only worked as a
 * regex because "ai" is a fixed, punctuation-free literal. Member display names
 * and agent catalog names contain spaces and collide with ordinary prose —
 * someone writing "ask codex about this" must not invoke Codex. So the composer
 * emits an unambiguous reference and the server never re-derives a target from
 * text.
 */

import type { CommentMentionInputDTO, CommentMentionTargetType } from "busabase-contract/types";

/**
 * Longest `error` we will persist on a mention row.
 *
 * Bounded because the string is whatever an agent's spawn failure produced —
 * a stack trace, a whole stderr dump — and it is rendered inline next to the
 * comment. Truncation is visible (ellipsis), never silent.
 */
export const MENTION_ERROR_MAX_LENGTH = 500;

export const truncateMentionError = (message: string): string =>
  message.length <= MENTION_ERROR_MAX_LENGTH
    ? message
    : `${message.slice(0, MENTION_ERROR_MAX_LENGTH - 1)}…`;

export type MentionValidationReason =
  | "out_of_bounds"
  | "empty_span"
  | "overlapping"
  | "splits_surrogate_pair"
  | "empty_target";

export class CommentMentionValidationError extends Error {
  readonly reason: MentionValidationReason;
  constructor(reason: MentionValidationReason, message: string) {
    super(message);
    this.name = "CommentMentionValidationError";
    this.reason = reason;
  }
}

/**
 * Would cutting `text` at `index` land between the two halves of a surrogate
 * pair?
 *
 * This is the CJK-heavy-product edge case §7.3 of the spec calls out
 * explicitly. Offsets are UTF-16 code units so that nothing has to convert at
 * the `<textarea>` boundary — but that means one visible astral character (an
 * emoji in a display name) occupies TWO units. A span that starts or ends
 * halfway through such a character would slice a lone surrogate out of the
 * body, which renders as a replacement glyph and shifts every later chip.
 * Plain CJK is unaffected: those code points are single UTF-16 units.
 */
export const splitsSurrogatePair = (text: string, index: number): boolean => {
  if (index <= 0 || index >= text.length) return false;
  const previous = text.charCodeAt(index - 1);
  const current = text.charCodeAt(index);
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff;
};

export interface NormalizedCommentMention {
  type: CommentMentionTargetType;
  targetId: string;
  start: number;
  end: number;
}

/**
 * Validate every span against the body and collapse duplicate agent picks.
 *
 * Throws rather than dropping: a mention the user deliberately made and that we
 * silently discard is the exact "looks like it worked, did nothing" failure
 * this whole feature exists to end. The one thing that IS collapsed is a
 * repeated agent — a second `@Codex` in the same comment would mean a second
 * session for one request, so the first occurrence wins and the rest are
 * dropped (the partial unique index is the database-side backstop for a forged
 * DTO that gets past here).
 *
 * Repeated MEMBER mentions are kept. "@Alice see the top — and @Alice the
 * footer too" is legitimate writing and each occurrence needs its own row to
 * render its own chip.
 */
export const normalizeCommentMentions = (
  body: string,
  mentions: readonly CommentMentionInputDTO[],
): NormalizedCommentMention[] => {
  const sorted = [...mentions].sort((a, b) => a.start - b.start || a.end - b.end);

  let previousEnd = -1;
  const seenAgentTargets = new Set<string>();
  const normalized: NormalizedCommentMention[] = [];

  for (const mention of sorted) {
    const targetId = mention.id.trim();
    if (!targetId) {
      throw new CommentMentionValidationError("empty_target", "Mention target id is empty.");
    }
    if (!Number.isInteger(mention.start) || !Number.isInteger(mention.end)) {
      throw new CommentMentionValidationError(
        "out_of_bounds",
        `Mention span [${mention.start}, ${mention.end}) is not a pair of integers.`,
      );
    }
    if (mention.start < 0 || mention.end > body.length) {
      throw new CommentMentionValidationError(
        "out_of_bounds",
        `Mention span [${mention.start}, ${mention.end}) is outside the comment body (length ${body.length}).`,
      );
    }
    if (mention.end <= mention.start) {
      throw new CommentMentionValidationError(
        "empty_span",
        `Mention span [${mention.start}, ${mention.end}) is empty.`,
      );
    }
    if (mention.start < previousEnd) {
      throw new CommentMentionValidationError(
        "overlapping",
        `Mention span [${mention.start}, ${mention.end}) overlaps the previous mention.`,
      );
    }
    if (splitsSurrogatePair(body, mention.start) || splitsSurrogatePair(body, mention.end)) {
      throw new CommentMentionValidationError(
        "splits_surrogate_pair",
        `Mention span [${mention.start}, ${mention.end}) splits a surrogate pair.`,
      );
    }

    previousEnd = mention.end;

    if (mention.type === "agent") {
      if (seenAgentTargets.has(targetId)) continue;
      seenAgentTargets.add(targetId);
    }
    normalized.push({ type: mention.type, targetId, start: mention.start, end: mention.end });
  }

  return normalized;
};

export const hasAgentMention = (mentions: readonly { type: CommentMentionTargetType }[]): boolean =>
  mentions.some((mention) => mention.type === "agent");

/**
 * Derive spans by locating each mention's literal text in the body.
 *
 * Only for authored fixtures (seed data, demo datasets) — the live composer
 * always knows its own offsets and never needs to search for them. Written this
 * way because a hand-counted offset in a CJK seed string is a silent corruption
 * waiting to happen: it looks right, renders one character off, and nobody
 * notices until a chip eats a character.
 *
 * A repeated label resolves to successive occurrences (the cursor only moves
 * forward), which is exactly what "mention @Alice twice" needs.
 */
export const mentionSpansFromLabels = <T extends { type: CommentMentionTargetType; text: string }>(
  body: string,
  labels: readonly T[],
): (T & { start: number; end: number })[] => {
  let cursor = 0;
  return labels.map((label) => {
    const start = body.indexOf(label.text, cursor);
    if (start < 0) {
      throw new Error(`Mention text ${JSON.stringify(label.text)} is not present in the body.`);
    }
    cursor = start + label.text.length;
    return { ...label, start, end: cursor };
  });
};

// ── Composer helpers (isomorphic: web `<textarea>` and RN `TextInput`) ────────

/** A mention held by a composer: a span plus the label the span must cover. */
export interface DraftCommentMention extends CommentMentionInputDTO {
  label: string;
}

/**
 * Where the caret sits inside an unfinished `@query`, or null when the user is
 * not composing a mention.
 *
 * The `@` is only honoured at a word boundary, so typing an email address
 * ("ping a@b.com") never opens the picker.
 */
export const findMentionQuery = (
  body: string,
  caret: number,
): { start: number; query: string } | null => {
  const upToCaret = body.slice(0, caret);
  const at = upToCaret.lastIndexOf("@");
  if (at < 0) return null;
  const before = at === 0 ? "" : upToCaret[at - 1];
  if (before && !/\s/.test(before)) return null;
  const query = upToCaret.slice(at + 1);
  // A newline ends the attempt; a long run of text means the user moved on.
  if (query.includes("\n") || query.length > 40) return null;
  return { start: at, query };
};

/**
 * Re-anchor spans after an arbitrary edit to the body.
 *
 * A mention survives only while the text under its span is still exactly the
 * label it was created for; anything else means the user edited through it, so
 * the mention goes with it. This is what makes "the composer owns these spans"
 * true rather than aspirational — without it a span could drift onto unrelated
 * text and the server would happily persist it.
 *
 * All the matching is whole-string (`slice`/`indexOf`), never a character loop
 * over `.length`, so an astral-plane character in a display name can never
 * leave a span cutting a surrogate pair in half.
 */
export const reanchorMentions = <T extends DraftCommentMention>(
  nextBody: string,
  mentions: readonly T[],
): T[] => {
  const kept: T[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    // Fast path: unchanged text before this mention leaves it exactly in place.
    if (mention.start >= cursor && nextBody.slice(mention.start, mention.end) === mention.label) {
      kept.push(mention);
      cursor = mention.end;
      continue;
    }
    const found = nextBody.indexOf(mention.label, cursor);
    if (found < 0) continue;
    kept.push({ ...mention, start: found, end: found + mention.label.length });
    cursor = found + mention.label.length;
  }
  return kept;
};

/**
 * Replace the in-progress `@query` with a picked candidate's chip text.
 *
 * Returns the new body, the caret to restore, and the mention list with the new
 * span appended — one function so no caller can update three of those four
 * things and forget the fourth.
 */
export const applyMentionPick = <T extends DraftCommentMention>(
  body: string,
  mentions: readonly T[],
  active: { start: number; query: string },
  candidate: { type: CommentMentionTargetType; id: string; label: string },
): { body: string; caret: number; mentions: T[] } => {
  const chip = `@${candidate.label}`;
  const after = body.slice(active.start + 1 + active.query.length);
  // A trailing space so the next keystroke is prose, not more of the label.
  const nextBody = `${body.slice(0, active.start)}${chip} ${after}`;
  return {
    body: nextBody,
    caret: active.start + chip.length + 1,
    mentions: [
      ...reanchorMentions(nextBody, mentions),
      {
        type: candidate.type,
        id: candidate.id,
        label: chip,
        start: active.start,
        end: active.start + chip.length,
      } as T,
    ],
  };
};

/** Strip the composer-only `label` so what is submitted is exactly the DTO. */
export const toMentionInputs = (
  mentions: readonly DraftCommentMention[],
): CommentMentionInputDTO[] =>
  mentions.map((mention) => ({
    type: mention.type,
    id: mention.id,
    start: mention.start,
    end: mention.end,
  }));

/**
 * Shift spans to match the body the SERVER will store.
 *
 * `createComment`'s input schema is `z.string().trim()`, so leading whitespace
 * disappears server-side and every offset moves with it. The shift is computed
 * exactly rather than re-searching for the labels: a search could latch onto an
 * earlier identical string that was never a mention.
 */
export const trimmedSubmission = (
  body: string,
  mentions: readonly DraftCommentMention[],
): { body: string; mentions: CommentMentionInputDTO[] } => {
  const leading = body.length - body.trimStart().length;
  return {
    body: body.trim(),
    mentions: toMentionInputs(mentions).map((mention) => ({
      ...mention,
      start: mention.start - leading,
      end: mention.end - leading,
    })),
  };
};

// ── Prompt template ───────────────────────────────────────────────────────────

/**
 * Context block handed to the agent alongside the comment.
 *
 * One block per commentable subject type. Adding `record`/`operation`/`commit`
 * support later means adding a block here, not a second prompt-construction
 * path — which is the whole reason the template lives in one function.
 */
export interface MentionPromptSubject {
  /** Human label for the thing being commented on, e.g. a Change Request title. */
  title: string;
  /** Its id, so an agent with workspace tools can look it up. */
  id: string;
  /** What kind of thing it is, in the product's own words. */
  kind: string;
  /** Rendered diff / snapshot. Empty string when there is nothing to show. */
  context: string;
}

/**
 * The fixed template every mention dispatch uses.
 *
 * Not "just forward the comment body": an agent receiving "fix the null check
 * on line 40" with no idea which Change Request that refers to cannot act on
 * it, and the user who typed it has every reason to expect that we supplied
 * the thing they were both looking at.
 */
export const buildMentionPrompt = (input: {
  subject: MentionPromptSubject;
  authorLabel: string;
  body: string;
}): string => {
  const lines = [
    `You were mentioned in a comment on ${input.subject.kind} "${input.subject.title}" (${input.subject.id}).`,
    "",
    `Comment from ${input.authorLabel}:`,
    input.body,
  ];
  if (input.subject.context.trim().length > 0) {
    lines.push("", `${input.subject.kind} contents:`, input.subject.context);
  }
  return lines.join("\n");
};
