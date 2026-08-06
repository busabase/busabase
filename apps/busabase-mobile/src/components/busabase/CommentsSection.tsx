import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommentSubjectType } from "busabase-contract/types";
import { MessageCircle, Send, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeInlineError,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
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
  const [composerOpen, setComposerOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

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
      setComposerOpen(false);
      setDiscardOpen(false);
      void queryClient.invalidateQueries({
        queryKey: buda?.orpc.comments.list.key({ input: { subjectType, subjectId } }),
      });
    },
  });

  const submit = () => {
    const trimmed = body.trim();
    if (trimmed) postMutation.mutate(trimmed);
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
          comments.map((comment) => {
            const mentionsAi = comment.mentionsAi;
            return (
              <NativeRow
                key={comment.id}
                title={comment.authorId}
                meta={formatDate(comment.createdAt)}
                leading={
                  mentionsAi ? (
                    <View style={[styles.aiAvatar, { backgroundColor: tokens.ai.fill }]}>
                      <Sparkles size={13} color={tokens.ai.text} />
                    </View>
                  ) : undefined
                }
              >
                <Text style={[typography.body, { color: tokens.foreground }]}>
                  {renderAiMentions(comment.body, tokens.ai.text)}
                </Text>
              </NativeRow>
            );
          })
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
          placeholder="Add a note (@ai to mention the agent)"
          onChangeText={setBody}
        />
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
  aiAvatar: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  input: { minHeight: 80, paddingTop: 12 },
});

function renderAiMentions(body: string, color: string) {
  let offset = 0;
  return body.split(/(@ai\b)/gi).map((part) => {
    const start = offset;
    offset += part.length;
    return /^@ai$/i.test(part) ? (
      <Text key={`${start}:${part}`} style={{ color, fontWeight: "600" }}>
        {part}
      </Text>
    ) : (
      part
    );
  });
}
