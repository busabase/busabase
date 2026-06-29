import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommentSubjectType } from "busabase-core/types";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
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
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");

  const commentsQuery = useQuery(
    buda
      ? buda.orpc.comments.list.queryOptions({ input: { subjectType, subjectId } })
      : { queryKey: ["no-connection", "comments", subjectType, subjectId], queryFn: skipToken },
  );
  const comments = commentsQuery.data ?? [];

  const postMutation = useMutation({
    mutationFn: async (trimmed: string) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.comments.create({
        subjectType,
        subjectId,
        body: trimmed,
        authorId: "mobile-reviewer",
        mentionsAi: /(^|\s)@ai(\s|$)/i.test(trimmed),
      });
    },
    onSuccess: () => {
      setBody("");
      void queryClient.invalidateQueries({
        queryKey: buda?.orpc.comments.list.key({ input: { subjectType, subjectId } }),
      });
    },
  });

  const submit = () => {
    const trimmed = body.trim();
    if (trimmed) postMutation.mutate(trimmed);
  };

  return (
    <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <Text style={[typography.h2, { color: tokens.foreground }]}>
        Comments ({comments.length})
      </Text>
      {commentsQuery.isLoading ? (
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
      {postMutation.error ? (
        <Text style={[typography.small, { color: tokens.destructive }]}>
          {postMutation.error.message}
        </Text>
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
        loading={postMutation.isPending}
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
