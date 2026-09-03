import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type {
  CommentMentionVO,
  CommentSubjectType,
  CommentVO,
  UserRefVO,
} from "busabase-contract/types";
import { AlertTriangle, Bot, Reply, Sparkles } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { trimmedSubmission } from "../../../logic/comment-mentions";
import { normalizeAgentTargets } from "../../agents/utils/agent-targets";
import { formatFullTime, formatUserRefLabel } from "../helpers/format";
import { UserAvatar, UserRefButton } from "./identity";
import {
  type MentionCandidate,
  MentionPicker,
  mentionCandidatesFromAgents,
  mentionCandidatesFromUsers,
  useMentionComposer,
} from "./mention-picker";
import { ShimmerSkeleton as Skeleton } from "./shimmer-skeleton";
import { openAgentChatTab } from "./side-panel-sources";

export const getAuthorInitials = (authorId: string) => {
  const clean = authorId.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!clean) {
    return "?";
  }
  const parts = clean.split(/\s+/);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : clean.slice(0, 2)).toUpperCase();
};

export function CommentAvatar({ ai, authorId }: { ai?: boolean; authorId: string }) {
  return (
    <div
      className={`flex size-7 shrink-0 items-center justify-center rounded-full font-medium text-[11px] ${
        ai ? "bg-ai/17 text-ai-strong dark:text-ai-soft" : "bg-muted text-muted-foreground"
      }`}
    >
      {ai ? <Sparkles size={13} /> : getAuthorInitials(authorId)}
    </div>
  );
}

/**
 * One mention chip, rendered from the persisted span — never from a regex over
 * the stored text. That is the whole reason mentions are structured: an agent
 * catalog name like "Claude Code" contains a space and collides with prose, so
 * "ask claude code about this" must render as ordinary words.
 */
function MentionChip({ mention, text }: { mention: CommentMentionVO; text: string }) {
  return (
    <span
      className={`rounded px-0.5 font-medium ${
        mention.type === "agent"
          ? "bg-ai/17 text-ai-strong dark:text-ai-soft"
          : "bg-primary/10 text-primary"
      }`}
      title={mention.label}
    >
      {text}
    </span>
  );
}

/**
 * Render one run of body text, highlighting any mention whose span falls
 * entirely inside it.
 *
 * `absoluteStart` is where `text` begins in the whole comment body, because the
 * persisted spans are absolute and the renderer works line by line (blockquote
 * prefixes are stripped for display, which shifts everything after them).
 * Slicing is done with `String.prototype.slice` on validated spans, so a
 * surrogate pair is never cut in half.
 */
export function renderMentionedText(
  text: string,
  absoluteStart: number,
  mentions: readonly CommentMentionVO[],
) {
  const end = absoluteStart + text.length;
  const inside = mentions
    .filter((mention) => mention.start >= absoluteStart && mention.end <= end)
    .sort((a, b) => a.start - b.start);
  if (inside.length === 0) return text;

  const parts: React.ReactNode[] = [];
  let cursor = absoluteStart;
  for (const mention of inside) {
    if (mention.start < cursor) continue; // defensive: overlapping spans are rejected server-side
    if (mention.start > cursor) {
      parts.push(
        <Fragment key={`t${cursor}`}>
          {text.slice(cursor - absoluteStart, mention.start - absoluteStart)}
        </Fragment>,
      );
    }
    parts.push(
      <MentionChip
        key={mention.id}
        mention={mention}
        text={text.slice(mention.start - absoluteStart, mention.end - absoluteStart)}
      />,
    );
    cursor = mention.end;
  }
  if (cursor < end) {
    parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor - absoluteStart)}</Fragment>);
  }
  return parts;
}

interface BodyLine {
  quote: boolean;
  text: string;
  /** Absolute offset of `text` in the untouched body, after any `>` prefix. */
  start: number;
}

/**
 * Split a body into lines that remember where they came from.
 *
 * The `>` prefix of a quoted line is dropped for display, which shortens the
 * line — so the only way a mention span still lines up is to carry each line's
 * post-prefix absolute offset rather than recomputing from the rendered text.
 */
export const splitBodyLines = (body: string): BodyLine[] => {
  const lines: BodyLine[] = [];
  let offset = 0;
  for (const raw of body.split("\n")) {
    const quote = raw.startsWith(">");
    const prefix = quote ? (raw.match(/^>\s?/)?.[0].length ?? 1) : 0;
    lines.push({ quote, text: raw.slice(prefix), start: offset + prefix });
    offset += raw.length + 1; // + the "\n" that `split` consumed
  }
  return lines;
};

export function CommentBody({
  body,
  mentions = [],
}: {
  body: string;
  mentions?: readonly CommentMentionVO[];
}) {
  // Group consecutive `>` lines into styled blockquotes (flat quote-reply).
  const blocks: { quote: boolean; lines: BodyLine[] }[] = [];
  for (const line of splitBodyLines(body)) {
    const last = blocks.at(-1);
    if (last && last.quote === line.quote) {
      last.lines.push(line);
    } else {
      blocks.push({ quote: line.quote, lines: [line] });
    }
  }
  return (
    <div className="mt-1 text-sm leading-6">
      {blocks.map((block) => (
        <div
          className={
            block.quote
              ? "my-1 break-words whitespace-pre-wrap border-muted-foreground/30 border-l-2 pl-2.5 text-muted-foreground"
              : "break-words whitespace-pre-wrap"
          }
          key={`b${block.lines[0]?.start ?? 0}`}
        >
          {block.lines.map((line, index) => (
            <Fragment key={line.start}>
              {index > 0 ? "\n" : null}
              {renderMentionedText(line.text, line.start, mentions)}
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Lifecycle of the agent mentions on one comment.
 *
 * A mention that is never reflected anywhere is the failure this whole feature
 * exists to end, so every agent mention shows *some* state: starting, started
 * (with a way into the conversation), or a named reason it could not start.
 * Once linked, running/done/failed belongs to the session itself — this strip
 * only owns the handoff.
 */
export function AgentMentionStatus({ mentions }: { mentions: readonly CommentMentionVO[] }) {
  const messages = useCoreI18n();
  const agentMentions = mentions.filter((mention) => mention.type === "agent");
  if (agentMentions.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {agentMentions.map((mention) => {
        if (mention.dispatchStatus === "failed") {
          return (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-rejected-strong"
              key={mention.id}
            >
              <AlertTriangle size={11} />
              {fmt(messages.comments.mentionFailed, {
                agent: mention.label,
                reason: mention.error ?? messages.comments.mentionFailedUnknown,
              })}
            </span>
          );
        }
        return (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-ai-strong dark:text-ai-soft"
            key={mention.id}
          >
            <Bot size={11} />
            {mention.dispatchStatus === "queued"
              ? fmt(messages.comments.mentionQueued, { agent: mention.label })
              : fmt(messages.comments.mentionLinked, { agent: mention.label })}
            {mention.sessionId ? (
              <button
                className="underline underline-offset-2 hover:no-underline"
                onClick={() =>
                  openAgentChatTab(mention.targetId, mention.label, {
                    sessionId: mention.sessionId ?? undefined,
                  })
                }
                type="button"
              >
                {messages.comments.mentionOpenSession}
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

export function CommentItem({
  comment,
  onQuoteReply,
}: {
  comment: CommentVO;
  onQuoteReply?: (comment: CommentVO) => void;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();

  return (
    <div className="group flex gap-2.5 border-border/40 border-b py-3 last:border-b-0">
      <UserAvatar fallbackId={comment.authorId} user={comment.author} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <UserRefButton
            fallbackId={comment.authorId}
            labelClassName="font-medium text-sm"
            title={messages.identity.commentAuthor}
            user={comment.author}
          />
          <span className="text-muted-foreground text-xs">
            {formatFullTime(comment.createdAt, locale)}
          </span>
          {onQuoteReply ? (
            <button
              className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              onClick={() => onQuoteReply(comment)}
              type="button"
            >
              <Reply size={12} />
              {messages.comments.quoteReply}
            </button>
          ) : null}
        </div>
        <CommentBody body={comment.body} mentions={comment.mentions} />
        <AgentMentionStatus mentions={comment.mentions} />
      </div>
    </div>
  );
}

export function SubjectCommentThread({
  client,
  emptyLabel,
  extraMentionCandidates,
  placeholder,
  readOnly = false,
  subjectId,
  subjectType,
}: {
  client: BusabaseDashboardApiClient;
  emptyLabel?: string;
  /**
   * People this surface knows about beyond the thread's own authors — a Change
   * Request's submitter and reviewers, for example. Kept as a prop rather than
   * a query because `busabase-core` deliberately has no space-member endpoint;
   * the identities it can mention are the ones its VOs already carry.
   */
  extraMentionCandidates?: readonly { id: string; user?: UserRefVO | null }[];
  placeholder?: string;
  readOnly?: boolean;
  subjectId: string;
  subjectType: CommentSubjectType;
}) {
  const messages = useCoreI18n();
  const queryClient = useQueryClient();
  const queryKey = ["busabase", "comments", subjectType, subjectId];
  const commentsQuery = useQuery({
    queryFn: () => client.listComments({ subjectId, subjectType }),
    queryKey,
  });
  const composer = useMentionComposer();
  const [error, setError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: (payload: Parameters<BusabaseDashboardApiClient["createComment"]>[0]) =>
      client.createComment(payload),
    onError: (mutationError) =>
      setError(mutationError instanceof Error ? mutationError.message : messages.comments.failed),
    onSuccess: () => {
      composer.reset();
      setError(null);
      queryClient.invalidateQueries({ queryKey });
    },
  });
  const comments = commentsQuery.data ?? [];
  const composerRef = useRef<HTMLTextAreaElement>(null);

  /**
   * The agent catalog is only fetched once the user actually types `@`. Probing
   * the machine for agent binaries every time a comment thread renders would be
   * a cost nobody asked for.
   */
  const pickerOpen = !readOnly && composer.query !== null;
  const catalogQuery = useQuery({
    enabled: pickerOpen,
    queryFn: () => client.listAgentCatalog(),
    queryKey: ["busabase", "agents", "catalog"],
    // A member without the agents floor gets a FORBIDDEN here; that is not an
    // error worth showing in a mention picker, it just means no agent rows.
    retry: false,
  });

  const candidates = useMemo<MentionCandidate[]>(() => {
    const people = mentionCandidatesFromUsers([
      ...comments.map((comment) => ({ id: comment.authorId, user: comment.author })),
      ...(extraMentionCandidates ?? []),
    ]);
    const agents = catalogQuery.data
      ? mentionCandidatesFromAgents(normalizeAgentTargets(catalogQuery.data))
      : [];
    return [...agents, ...people];
  }, [catalogQuery.data, comments, extraMentionCandidates]);

  const usedAgentIds = composer.mentions
    .filter((mention) => mention.type === "agent")
    .map((mention) => mention.id);

  const focusCaret = (caret: number) => {
    requestAnimationFrame(() => {
      const element = composerRef.current;
      if (element) {
        element.focus();
        element.setSelectionRange(caret, caret);
      }
    });
  };

  // Quote reply: prefill the composer with the comment as a markdown blockquote
  // (flat, GitHub-style — no nested threads), then focus it.
  const quoteReply = (comment: CommentVO) => {
    const quoted = comment.body
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const prefix =
      composer.body.trim().length > 0 ? `${composer.body.replace(/\s+$/, "")}\n\n` : "";
    const next = `${prefix}> ${fmt(messages.comments.quotedAttribution, {
      author: formatUserRefLabel(comment.author, comment.authorId, messages),
    })}\n${quoted}\n\n`;
    composer.setRawBody(next);
    focusCaret(next.length);
  };

  const submit = () => {
    if (composer.body.trim().length === 0) return;
    // The server stores the TRIMMED body (`z.string().trim()`), so the spans
    // have to be shifted to match it — `trimmedSubmission` owns that arithmetic
    // and is shared with mobile.
    const submission = trimmedSubmission(composer.body, composer.mentions);
    createMutation.mutate({
      authorId: "local-admin",
      body: submission.body,
      mentions: submission.mentions,
      subjectId,
      subjectType,
    });
  };

  return (
    <div>
      {comments.length > 0 ? (
        <div>
          {comments.map((comment) => (
            <CommentItem
              comment={comment}
              key={comment.id}
              onQuoteReply={readOnly ? undefined : quoteReply}
            />
          ))}
        </div>
      ) : commentsQuery.isLoading ? (
        <div className="space-y-2 rounded-md bg-muted/25 px-3 py-3" aria-hidden>
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <div className="rounded-md bg-muted/25 px-3 py-3 text-muted-foreground text-sm">
          {emptyLabel ?? messages.comments.noComments}
        </div>
      )}

      {!readOnly && error ? (
        <div className="mt-2 rounded-md border border-rejected/35 bg-rejected/17 px-3 py-2 text-rejected-strong text-sm">
          {error}
        </div>
      ) : null}

      {readOnly ? null : (
        <div className="relative mt-2">
          <textarea
            aria-label={messages.comments.addComment}
            className="min-h-16 w-full resize-y rounded-md border border-border/70 bg-card px-2.5 py-2 text-sm leading-6 outline-none transition-colors focus:border-primary"
            onBlur={composer.dismiss}
            onChange={(event) =>
              composer.setBody(event.target.value, event.target.selectionStart ?? 0)
            }
            onKeyDown={(event) => {
              if (event.key === "Escape" && composer.query) {
                event.preventDefault();
                composer.dismiss();
              }
            }}
            placeholder={placeholder ?? messages.comments.placeholder}
            ref={composerRef}
            value={composer.body}
          />
          {composer.query ? (
            <MentionPicker
              candidates={candidates}
              emptyLabel={messages.comments.mentionPickerEmpty}
              errorLabel={messages.comments.mentionPickerError}
              isError={catalogQuery.isError}
              isLoading={catalogQuery.isPending}
              loadingLabel={messages.comments.mentionPickerLoading}
              onPick={(candidate) => {
                const { caret } = composer.pick(candidate);
                focusCaret(caret);
              }}
              onRetry={() => void catalogQuery.refetch()}
              query={composer.query.query}
              retryLabel={messages.comments.mentionPickerRetry}
              usedAgentIds={usedAgentIds}
            />
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-2">
            {usedAgentIds.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-ai-strong dark:text-ai-soft">
                <Sparkles size={11} />
                {messages.comments.agentWillRevise}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {messages.comments.mentionHint}
              </span>
            )}
            <button
              className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background text-xs transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={createMutation.isPending || composer.body.trim().length === 0}
              onClick={submit}
              type="button"
            >
              {createMutation.isPending ? messages.comments.posting : messages.comments.comment}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
