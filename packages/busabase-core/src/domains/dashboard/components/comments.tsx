import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { CommentSubjectType, CommentVO } from "busabase-contract/types";
import { Reply, Sparkles } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { formatUserRefLabel } from "../helpers/format";
import { UserAvatar, UserRefButton } from "./identity";

export const parseMentionsAi = (text: string) => /(^|\s)@ai\b/i.test(text);

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
        ai
          ? "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {ai ? <Sparkles size={13} /> : getAuthorInitials(authorId)}
    </div>
  );
}

export function AiMentionBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 font-medium text-[10px] text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
      <Sparkles size={10} />
      @ai
    </span>
  );
}

// Highlight @ai mentions inline without dangerouslySetInnerHTML.
export function renderInlineBody(text: string) {
  return text.split(/(@ai\b)/gi).map((part, index) =>
    /^@ai$/i.test(part) ? (
      <span
        className="font-medium text-violet-700 dark:text-violet-300"
        // biome-ignore lint/suspicious/noArrayIndexKey: inline text fragments have no stable id
        key={index}
      >
        {part}
      </span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: inline text fragments have no stable id
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

export function CommentBody({ body }: { body: string }) {
  // Group consecutive `>` lines into styled blockquotes (flat quote-reply).
  const blocks: { quote: boolean; text: string }[] = [];
  for (const line of body.split("\n")) {
    const quote = line.startsWith(">");
    const text = quote ? line.replace(/^>\s?/, "") : line;
    const last = blocks.at(-1);
    if (last && last.quote === quote) {
      last.text += `\n${text}`;
    } else {
      blocks.push({ quote, text });
    }
  }
  return (
    <div className="mt-1 text-sm leading-6">
      {blocks.map((block, index) =>
        block.quote ? (
          <div
            className="my-1 break-words whitespace-pre-wrap border-muted-foreground/30 border-l-2 pl-2.5 text-muted-foreground"
            // biome-ignore lint/suspicious/noArrayIndexKey: derived block list has no stable id
            key={index}
          >
            {renderInlineBody(block.text)}
          </div>
        ) : (
          <div
            className="break-words whitespace-pre-wrap"
            // biome-ignore lint/suspicious/noArrayIndexKey: derived block list has no stable id
            key={index}
          >
            {renderInlineBody(block.text)}
          </div>
        ),
      )}
    </div>
  );
}

export function CommentItem({
  comment,
  onQuoteReply,
}: {
  comment: CommentVO;
  onQuoteReply: (comment: CommentVO) => void;
}) {
  const messages = useCoreI18n();

  return (
    <div className="group flex gap-2.5 border-border/40 border-b py-3 last:border-b-0">
      {comment.mentionsAi ? (
        <CommentAvatar ai authorId={comment.authorId} />
      ) : (
        <UserAvatar fallbackId={comment.authorId} user={comment.author} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <UserRefButton
            fallbackId={comment.authorId}
            labelClassName="font-medium text-sm"
            title="Comment author"
            user={comment.author}
          />
          {comment.mentionsAi ? <AiMentionBadge /> : null}
          <span className="text-muted-foreground text-xs">
            {new Date(comment.createdAt).toLocaleString()}
          </span>
          <button
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => onQuoteReply(comment)}
            type="button"
          >
            <Reply size={12} />
            {messages.comments.quoteReply}
          </button>
        </div>
        <CommentBody body={comment.body} />
      </div>
    </div>
  );
}

export function SubjectCommentThread({
  client,
  emptyLabel,
  placeholder,
  subjectId,
  subjectType,
}: {
  client: BusabaseDashboardApiClient;
  emptyLabel?: string;
  placeholder?: string;
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
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: (text: string) =>
      client.createComment({
        authorId: "local-admin",
        body: text,
        mentionsAi: parseMentionsAi(text),
        subjectId,
        subjectType,
      }),
    onError: (mutationError) =>
      setError(mutationError instanceof Error ? mutationError.message : messages.comments.failed),
    onSuccess: () => {
      setBody("");
      setError(null);
      queryClient.invalidateQueries({ queryKey });
    },
  });
  const comments = commentsQuery.data ?? [];
  const mentionsAi = parseMentionsAi(body);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Quote reply: prefill the composer with the comment as a markdown blockquote
  // (flat, GitHub-style — no nested threads), then focus it.
  const quoteReply = (comment: CommentVO) => {
    const quoted = comment.body
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    setBody((current) => {
      const prefix = current.trim().length > 0 ? `${current.replace(/\s+$/, "")}\n\n` : "";
      return `${prefix}> ${fmt(messages.comments.quotedAttribution, {
        author: formatUserRefLabel(comment.author, comment.authorId, messages),
      })}\n${quoted}\n\n`;
    });
    requestAnimationFrame(() => {
      const element = composerRef.current;
      if (element) {
        element.focus();
        element.setSelectionRange(element.value.length, element.value.length);
      }
    });
  };

  return (
    <div>
      {comments.length > 0 ? (
        <div className="border-border/50 border-t">
          {comments.map((comment) => (
            <CommentItem comment={comment} key={comment.id} onQuoteReply={quoteReply} />
          ))}
        </div>
      ) : (
        <div className="border-border/50 border-t px-1 py-4 text-muted-foreground text-sm">
          {commentsQuery.isLoading
            ? messages.comments.loading
            : (emptyLabel ?? messages.comments.noComments)}
        </div>
      )}

      {error ? (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">
          {error}
        </div>
      ) : null}

      <div className="mt-2 rounded-md border border-border/70 bg-background/55 p-2.5">
        <textarea
          aria-label={messages.comments.addComment}
          className="min-h-16 w-full resize-y rounded-md border border-border/70 bg-background px-2.5 py-2 text-sm leading-6 outline-none transition-colors focus:border-primary"
          onChange={(event) => setBody(event.target.value)}
          placeholder={placeholder ?? messages.comments.placeholder}
          ref={composerRef}
          value={body}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          {mentionsAi ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-violet-700 dark:text-violet-300">
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
            disabled={createMutation.isPending || body.trim().length === 0}
            onClick={() => createMutation.mutate(body.trim())}
            type="button"
          >
            {createMutation.isPending ? messages.comments.posting : messages.comments.comment}
          </button>
        </div>
      </div>
    </div>
  );
}
