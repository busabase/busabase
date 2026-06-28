import type { CommentSubjectType, CommentVO } from "busabase-core/types";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBusabaseClient } from "~/api/use-busabase-client";
import { formatDate } from "~/lib/format";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

interface CommentsSectionProps {
  subjectType: CommentSubjectType;
  subjectId: string;
}

export function CommentsSection({ subjectType, subjectId }: CommentsSectionProps) {
  const tokens = useTokens();
  const client = useBusabaseClient();
  const [comments, setComments] = useState<CommentVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setComments(await client.comments.list({ subjectType, subjectId }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load comments");
    } finally {
      setLoading(false);
    }
  }, [client, subjectType, subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const trimmed = body.trim();
    if (!client || !trimmed) {
      return;
    }
    setPosting(true);
    setError(null);
    try {
      const comment = await client.comments.create({
        subjectType,
        subjectId,
        body: trimmed,
        authorId: "mobile-reviewer",
        mentionsAi: /(^|\s)@ai(\s|$)/i.test(trimmed),
      });
      setComments((current) => [...current, comment]);
      setBody("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not post comment");
    } finally {
      setPosting(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <Text style={[typography.h2, { color: tokens.foreground }]}>
        Comments ({comments.length})
      </Text>
      {loading ? (
        <Text style={[typography.body, { color: tokens.mutedForeground }]}>
          Loading comments...
        </Text>
      ) : comments.length === 0 ? (
        <Text style={[typography.body, { color: tokens.mutedForeground }]}>No comments yet.</Text>
      ) : (
        comments.map((comment) => (
          <View key={comment.id} style={[styles.comment, { borderColor: tokens.border }]}>
            <View style={styles.commentHeader}>
              <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
                {comment.authorId}
              </Text>
              <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                {formatDate(comment.createdAt)}
              </Text>
            </View>
            <Text style={[typography.body, { color: tokens.foreground }]}>{comment.body}</Text>
          </View>
        ))
      )}
      {error ? (
        <Text style={[typography.small, { color: tokens.destructive }]}>{error}</Text>
      ) : null}
      <TextInput
        label="Add comment"
        value={body}
        multiline
        style={styles.input}
        textAlignVertical="top"
        placeholder="Write a note (@ai to mention the agent)"
        onChangeText={setBody}
      />
      <Button
        label="Post comment"
        loading={posting}
        disabled={body.trim().length === 0}
        fullWidth
        onPress={submit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 16,
    gap: 12,
  },
  comment: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    gap: 6,
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  input: { minHeight: 80, paddingTop: 12 },
});
