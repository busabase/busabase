"use client";

/**
 * The `@` picker and the composer state that owns its spans.
 *
 * Two things live here because they are one idea: a mention is a span into the
 * comment body, and the only component that can keep those spans truthful is
 * the one that also owns every edit to the body. Splitting "the dropdown" from
 * "the offsets" would put the invariant in two places.
 *
 * The list is deliberately member+agent in one flat surface: at the "type `@`,
 * see a list, pick one" step the two are the same interaction, and the fork
 * (tag vs. invoke) happens after selection, invisibly.
 */

import type { UserRefVO } from "busabase-contract/types";
import { Bot, UserRound } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  applyMentionPick,
  type DraftCommentMention,
  findMentionQuery,
  reanchorMentions,
} from "../../../logic/comment-mentions";
import type { AgentTarget } from "../../agents/utils/agent-targets";

export interface MentionCandidate {
  type: "member" | "agent";
  /** Member/actor id, or launchable agent slug. */
  id: string;
  label: string;
  /** Secondary line: an email for a member, the connector name for an agent. */
  hint?: string | null;
  user?: UserRefVO | null;
}

/** A mention held by the composer. Shape shared with mobile via `busabase-core/logic/comment-mentions`. */
export type DraftMention = DraftCommentMention;

export const mentionCandidatesFromUsers = (
  entries: readonly { id: string; user?: UserRefVO | null }[],
): MentionCandidate[] => {
  const byId = new Map<string, MentionCandidate>();
  for (const entry of entries) {
    if (!entry.id || byId.has(entry.id)) continue;
    byId.set(entry.id, {
      type: "member",
      id: entry.id,
      label: entry.user?.name?.trim() || entry.user?.email?.trim() || entry.id,
      hint: entry.user?.email ?? null,
      user: entry.user ?? null,
    });
  }
  return [...byId.values()];
};

export const mentionCandidatesFromAgents = (targets: readonly AgentTarget[]): MentionCandidate[] =>
  targets.map((target) => ({
    type: "agent" as const,
    id: target.slug,
    label: target.name,
    hint: target.connectorName ?? null,
  }));

export interface MentionComposerState {
  body: string;
  mentions: DraftMention[];
  query: { start: number; query: string } | null;
  setBody: (next: string, caret: number) => void;
  reset: () => void;
  /** Replace the in-progress `@query` with the picked candidate's chip text. */
  pick: (candidate: MentionCandidate) => { body: string; caret: number };
  dismiss: () => void;
}

export const useMentionComposer = (
  initialBody = "",
): MentionComposerState & { setRawBody: (next: string) => void } => {
  const [body, setBodyState] = useState(initialBody);
  const [mentions, setMentions] = useState<DraftMention[]>([]);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);

  const setBody = useCallback((next: string, caret: number) => {
    setBodyState(next);
    setMentions((current) => reanchorMentions(next, current));
    setQuery(findMentionQuery(next, caret));
  }, []);

  // Programmatic writes (quote-reply prefill, post-submit clear) are not typing:
  // they must not open the picker, and they still have to re-anchor.
  const setRawBody = useCallback((next: string) => {
    setBodyState(next);
    setMentions((current) => reanchorMentions(next, current));
    setQuery(null);
  }, []);

  const reset = useCallback(() => {
    setBodyState("");
    setMentions([]);
    setQuery(null);
  }, []);

  const pick = useCallback(
    (candidate: MentionCandidate) => {
      const active = query;
      if (!active) return { body, caret: body.length };
      const applied = applyMentionPick(body, mentions, active, candidate);
      setBodyState(applied.body);
      setMentions(applied.mentions);
      setQuery(null);
      return { body: applied.body, caret: applied.caret };
    },
    [body, mentions, query],
  );

  const dismiss = useCallback(() => setQuery(null), []);

  return { body, mentions, query, setBody, setRawBody, reset, pick, dismiss };
};

/**
 * Loading, failed and genuinely-empty are three different answers.
 *
 * Collapsing them is the specific bug the failure matrix calls out: a network
 * blip that renders as "you have no agents" quietly turns a working setup into
 * an absent feature, and the user has no way to tell which happened. The
 * member half of the list stays usable in every one of the three.
 */
export function MentionPicker({
  candidates,
  emptyLabel,
  errorLabel,
  isError,
  isLoading,
  loadingLabel,
  onPick,
  onRetry,
  query,
  retryLabel,
  /** Agent slugs already mentioned in this comment — picking one twice would double-invoke. */
  usedAgentIds,
}: {
  candidates: readonly MentionCandidate[];
  emptyLabel: string;
  errorLabel: string;
  isError: boolean;
  isLoading: boolean;
  loadingLabel: string;
  onPick: (candidate: MentionCandidate) => void;
  onRetry: () => void;
  query: string;
  retryLabel: string;
  usedAgentIds: readonly string[];
}) {
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      candidates
        .filter(
          (candidate) =>
            needle.length === 0 ||
            candidate.label.toLowerCase().includes(needle) ||
            candidate.id.toLowerCase().includes(needle),
        )
        .slice(0, 8),
    [candidates, needle],
  );

  return (
    <div className="absolute z-30 mt-1 w-72 overflow-hidden rounded-md border bg-card shadow-lg">
      {/* The agent half failed to load. Shown ABOVE any member results rather
          than instead of them: the members are still perfectly pickable, and
          the user needs to know the agent list is missing, not empty. */}
      {isError ? (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1">{errorLabel}</span>
          <button
            className="shrink-0 underline underline-offset-2 hover:no-underline"
            onMouseDown={(event) => {
              event.preventDefault();
              onRetry();
            }}
            type="button"
          >
            {retryLabel}
          </button>
        </div>
      ) : null}
      {filtered.length === 0 ? (
        <p className="px-3 py-2 text-muted-foreground text-sm">
          {isLoading ? loadingLabel : emptyLabel}
        </p>
      ) : (
        <div className="flex max-h-60 flex-col overflow-y-auto py-1">
          {filtered.map((candidate) => {
            const alreadyUsed = candidate.type === "agent" && usedAgentIds.includes(candidate.id);
            return (
              <button
                className="flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                disabled={alreadyUsed}
                key={`${candidate.type}:${candidate.id}`}
                // `onMouseDown` rather than `onClick`: a click would blur the
                // textarea first, and the blur handler closes the picker.
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(candidate);
                }}
                type="button"
              >
                {candidate.type === "agent" ? (
                  <Bot className="size-4 shrink-0 text-ai-strong dark:text-ai-soft" />
                ) : (
                  <UserRound className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
                {candidate.hint ? (
                  <span className="max-w-[40%] shrink-0 truncate text-muted-foreground text-xs">
                    {candidate.hint}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
