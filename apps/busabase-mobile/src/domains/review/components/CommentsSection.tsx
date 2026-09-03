import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentCatalogEntryVO } from "busabase-contract/domains/agents/types";
import type { CommentMentionVO, CommentSubjectType, CommentVO } from "busabase-contract/types";
import { normalizeAgentTargets } from "busabase-core/domains/agents/utils/agent-targets";
import {
  applyMentionPick,
  type DraftCommentMention,
  findMentionQuery,
  reanchorMentions,
  trimmedSubmission,
} from "busabase-core/logic/comment-mentions";
import { Bot, MessageCircle, Send, UserRound } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeInlineError,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { formatDate } from "~/lib/format";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface CommentsSectionProps {
  subjectType: CommentSubjectType;
  subjectId: string;
}

interface MentionCandidate {
  type: "member" | "agent";
  id: string;
  label: string;
  hint?: string | null;
}

export function CommentsSection({ subjectType, subjectId }: CommentsSectionProps) {
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<DraftCommentMention[]>([]);
  const [caret, setCaret] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const commentsQuery = useQuery(
    buda
      ? buda.orpc.comments.list.queryOptions({ input: { subjectType, subjectId } })
      : { queryKey: ["no-connection", "comments", subjectType, subjectId], queryFn: skipToken },
  );
  const comments = commentsQuery.data ?? [];

  const mentionQuery = findMentionQuery(body, caret);

  // Only probed once the user actually types `@`. On a phone this also means a
  // read-only browse of a thread never asks the server about agents at all.
  const catalogQuery = useQuery(
    buda && composerOpen && mentionQuery
      ? { ...buda.orpc.agents.catalog.queryOptions(), retry: false }
      : { queryKey: ["no-connection", "agents", "catalog"], queryFn: skipToken },
  );

  const candidates = useMemo<MentionCandidate[]>(() => {
    const people = new Map<string, MentionCandidate>();
    for (const comment of comments) {
      if (people.has(comment.authorId)) continue;
      people.set(comment.authorId, {
        type: "member",
        id: comment.authorId,
        label: comment.author?.name?.trim() || comment.author?.email?.trim() || comment.authorId,
        hint: comment.author?.email ?? null,
      });
    }
    const agents = normalizeAgentTargets((catalogQuery.data ?? []) as AgentCatalogEntryVO[]).map(
      (target) => ({
        type: "agent" as const,
        id: target.slug,
        label: target.name,
        hint: target.connectorName ?? null,
      }),
    );
    return [...agents, ...people.values()];
  }, [catalogQuery.data, comments]);

  const filteredCandidates = useMemo(() => {
    if (!mentionQuery) return [];
    const needle = mentionQuery.query.trim().toLowerCase();
    const usedAgentIds = mentions.filter((m) => m.type === "agent").map((m) => m.id);
    return candidates
      .filter((candidate) => !(candidate.type === "agent" && usedAgentIds.includes(candidate.id)))
      .filter(
        (candidate) =>
          needle.length === 0 ||
          candidate.label.toLowerCase().includes(needle) ||
          candidate.id.toLowerCase().includes(needle),
      )
      .slice(0, 6);
  }, [candidates, mentionQuery, mentions]);

  const postMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error("Not connected");
      // Same shared arithmetic the web composer uses, so a mention posted from
      // a phone lands on exactly the offsets a mention posted from the browser
      // would — that parity is the whole point of sharing these helpers.
      const submission = trimmedSubmission(body, mentions);
      return buda.client.comments.create({
        subjectType,
        subjectId,
        body: submission.body,
        authorId: "mobile-reviewer",
        mentions: submission.mentions,
      });
    },
    onSuccess: () => {
      setBody("");
      setMentions([]);
      setCaret(0);
      setComposerOpen(false);
      setDiscardOpen(false);
      void queryClient.invalidateQueries({
        queryKey: buda?.orpc.comments.list.key({ input: { subjectType, subjectId } }),
      });
    },
  });

  const changeBody = (next: string) => {
    setBody(next);
    setMentions((current) => reanchorMentions(next, current));
  };

  const pickCandidate = (candidate: MentionCandidate) => {
    if (!mentionQuery) return;
    const applied = applyMentionPick(body, mentions, mentionQuery, candidate);
    setBody(applied.body);
    setMentions(applied.mentions);
    setCaret(applied.caret);
  };

  const submit = () => {
    if (body.trim()) postMutation.mutate();
  };

  const closeComposer = () => {
    if (postMutation.isPending) {
      return;
    }
    if (body.trim()) {
      setDiscardOpen(true);
      return;
    }
    setComposerOpen(false);
  };

  const discardComment = () => {
    if (postMutation.isPending) {
      return;
    }
    setBody("");
    setMentions([]);
    setCaret(0);
    setComposerOpen(false);
    setDiscardOpen(false);
    postMutation.reset();
  };

  return (
    <>
      <NativeSection title="Comments" caption={`${comments.length}`}>
        {commentsQuery.isLoading ? (
          <NativeRow
            title="Loading comments"
            leading={<MessageCircle size={18} color={tokens.mutedForeground} />}
          />
        ) : comments.length === 0 ? (
          <NativeRow
            title="No comments"
            leading={<MessageCircle size={18} color={tokens.mutedForeground} />}
          />
        ) : (
          comments.map((comment: CommentVO) => (
            <NativeRow
              key={comment.id}
              title={comment.authorId}
              meta={formatDate(comment.createdAt)}
            >
              <Text style={[typography.body, { color: tokens.foreground }]}>
                {renderMentions(comment.body, comment.mentions, tokens.ai.text, tokens.primary)}
              </Text>
              <AgentMentionStatus mentions={comment.mentions} color={tokens.ai.text} />
            </NativeRow>
          ))
        )}
        <NativeRow
          title="Add comment"
          leading={<MessageCircle size={18} color={tokens.mutedForeground} />}
          onPress={() => {
            postMutation.reset();
            setComposerOpen(true);
          }}
          last
        />
      </NativeSection>

      <NativeBottomSheet
        visible={composerOpen && !discardOpen}
        title="Add comment"
        showCloseButton
        onClose={closeComposer}
        footer={
          <NativeActionBar>
            {postMutation.error ? (
              <NativeInlineError
                message={postMutation.error.message}
                onReset={() => postMutation.reset()}
              />
            ) : null}
            <Button
              label="Post comment"
              leadingIcon={<Send size={18} color={tokens.primaryForeground} />}
              loading={postMutation.isPending}
              disabled={postMutation.isPending || body.trim().length === 0}
              fullWidth
              onPress={submit}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={postMutation.isPending}
              fullWidth
              onPress={closeComposer}
            />
          </NativeActionBar>
        }
      >
        <TextInput
          accessibilityLabel="Comment"
          value={body}
          multiline
          style={styles.input}
          textAlignVertical="top"
          placeholder="Add a note — type @ to mention a teammate or an agent"
          onChangeText={changeBody}
          onSelectionChange={(event) => setCaret(event.nativeEvent.selection.end)}
        />
        {mentionQuery ? (
          <View
            style={[styles.picker, { borderColor: tokens.border, backgroundColor: tokens.card }]}
          >
            {filteredCandidates.length === 0 ? (
              <Text
                style={[typography.small, styles.pickerEmpty, { color: tokens.mutedForeground }]}
              >
                {catalogQuery.isPending ? "Loading agents…" : "No matching people or agents."}
              </Text>
            ) : (
              filteredCandidates.map((candidate) => (
                <Pressable
                  accessibilityRole="button"
                  key={`${candidate.type}:${candidate.id}`}
                  onPress={() => pickCandidate(candidate)}
                  style={styles.pickerRow}
                >
                  {candidate.type === "agent" ? (
                    <Bot size={16} color={tokens.ai.text} />
                  ) : (
                    <UserRound size={16} color={tokens.mutedForeground} />
                  )}
                  <Text style={[typography.body, styles.pickerLabel, { color: tokens.foreground }]}>
                    {candidate.label}
                  </Text>
                  {candidate.hint ? (
                    <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                      {candidate.hint}
                    </Text>
                  ) : null}
                </Pressable>
              ))
            )}
          </View>
        ) : null}
      </NativeBottomSheet>
      <NativeBottomSheet
        visible={discardOpen}
        title="Discard comment?"
        description="This closes the comment composer and removes your unsent note."
        showCloseButton
        onClose={() => setDiscardOpen(false)}
        footer={
          <NativeActionBar>
            <Button
              label="Discard comment"
              variant="destructive"
              disabled={postMutation.isPending}
              fullWidth
              onPress={discardComment}
            />
            <Button
              label="Keep editing"
              variant="ghost"
              disabled={postMutation.isPending}
              fullWidth
              onPress={() => setDiscardOpen(false)}
            />
          </NativeActionBar>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 80, paddingTop: 12 },
  picker: {
    marginTop: spacing[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  pickerEmpty: { paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  pickerLabel: { flex: 1 },
  status: { marginTop: spacing[1] },
});

/**
 * Render chips from the persisted spans, never from a regex over the text.
 *
 * Web and mobile must produce the same chips for the same comment; they can only
 * do that by reading the same structured spans instead of each re-deriving
 * targets from prose with their own copy of a pattern (which is exactly what the
 * two `@ai` regexes that used to live in this file were).
 */
function renderMentions(
  body: string,
  mentions: readonly CommentMentionVO[],
  agentColor: string,
  memberColor: string,
) {
  const ordered = [...mentions].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const mention of ordered) {
    if (mention.start < cursor || mention.end > body.length) continue;
    if (mention.start > cursor) parts.push(body.slice(cursor, mention.start));
    parts.push(
      <Text
        key={mention.id}
        style={{
          color: mention.type === "agent" ? agentColor : memberColor,
          fontWeight: "600",
        }}
      >
        {body.slice(mention.start, mention.end)}
      </Text>,
    );
    cursor = mention.end;
  }
  if (cursor < body.length) parts.push(body.slice(cursor));
  return parts;
}

/** Mirrors the web status strip: an agent mention always shows what happened to it. */
function AgentMentionStatus({
  mentions,
  color,
}: {
  mentions: readonly CommentMentionVO[];
  color: string;
}) {
  const tokens = useTokens();
  const agentMentions = mentions.filter((mention) => mention.type === "agent");
  if (agentMentions.length === 0) return null;
  return (
    <View style={styles.status}>
      {agentMentions.map((mention) => (
        <Text
          key={mention.id}
          style={[
            typography.small,
            { color: mention.dispatchStatus === "failed" ? tokens.destructive : color },
          ]}
        >
          {mention.dispatchStatus === "failed"
            ? `${mention.label} couldn't start — ${mention.error ?? "no reason reported"}`
            : mention.dispatchStatus === "queued"
              ? `Starting ${mention.label}…`
              : `${mention.label} was asked to help.`}
        </Text>
      ))}
    </View>
  );
}
