import type { ChangeRequestVO, CommentVO, RecordVO } from "busabase-core/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseClient } from "~/api/use-busabase-client";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { FieldList } from "~/components/busabase/FieldList";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeScreen,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { StatusBadge } from "~/components/ui/StatusBadge";
import { TextInput } from "~/components/ui/TextInput";
import { getChangeRequestTitle, getRecordTitle } from "~/lib/busabase-display";
import { formatDate, shortId } from "~/lib/format";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function RecordDetailContent() {
  const params = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const tokens = useTokens();
  const client = useBusabaseClient();
  const recordId = typeof params.id === "string" ? params.id : "";
  const [record, setRecord] = useState<RecordVO | null>(null);
  const [history, setHistory] = useState<ChangeRequestVO[]>([]);
  const [comments, setComments] = useState<CommentVO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [postingComment, setPostingComment] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!client || !recordId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextRecord, nextHistory, nextComments] = await Promise.all([
        client.records.get({ recordId }),
        client.records.listChangeRequests({ recordId }).catch(() => []),
        client.comments.list({ subjectType: "record", subjectId: recordId }).catch(() => []),
      ]);
      setRecord(nextRecord);
      setHistory(nextHistory);
      setComments(nextComments);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load record");
    } finally {
      setLoading(false);
    }
  }, [client, recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitComment = async () => {
    const body = commentBody.trim();
    if (!client || !recordId || !body) {
      return;
    }
    setPostingComment(true);
    setCommentError(null);
    try {
      const comment = await client.comments.create({
        subjectType: "record",
        subjectId: recordId,
        body,
        authorId: "mobile-reviewer",
        mentionsAi: /(^|\s)@ai(\s|$)/i.test(body),
      });
      setComments((current) => [...current, comment]);
      setCommentBody("");
    } catch (caught) {
      setCommentError(caught instanceof Error ? caught.message : "Could not post comment");
    } finally {
      setPostingComment(false);
    }
  };

  const deleteRecord = async () => {
    if (!client || !recordId) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const changeRequest = await client.records.deleteChangeRequest({
        recordId,
        message: "Delete record",
        submittedBy: "mobile-editor",
      });
      router.replace({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create delete change request");
    } finally {
      setDeleting(false);
    }
  };

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/drawer/records"))}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  if (loading) {
    return (
      <NativeScreen title="Record" subtitle="Loading record" headerLeading={headerLeading}>
        <NativeLoadingState label="Loading record" />
      </NativeScreen>
    );
  }

  if (error && !record) {
    return (
      <NativeScreen title="Record" subtitle={shortId(recordId)} headerLeading={headerLeading}>
        <NativeErrorState message={error} onRetry={load} />
      </NativeScreen>
    );
  }

  if (!record) {
    return (
      <NativeScreen title="Record" subtitle={shortId(recordId)} headerLeading={headerLeading}>
        <NativeEmptyState
          title="Record not found"
          description="This canonical record is no longer available."
        />
      </NativeScreen>
    );
  }

  return (
    <NativeScreen
      title={getRecordTitle(record)}
      subtitle={`${record.base.name} · ${formatDate(record.updatedAt)}`}
      headerLeading={headerLeading}
    >
      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.statusRow}>
            <StatusBadge status={record.status} />
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>
              commit {shortId(record.headCommitId)} · by {record.createdBy}
            </Text>
          </View>
          <View style={styles.recordActions}>
            <View style={styles.recordActionItem}>
              <Button
                label="Edit"
                variant="secondary"
                fullWidth
                onPress={() =>
                  router.push({ pathname: "/records/[id]/edit", params: { id: record.id } })
                }
              />
            </View>
            <View style={styles.recordActionItem}>
              <Button
                label={deleting ? "Submitting..." : "Delete"}
                variant="destructive"
                loading={deleting}
                fullWidth
                onPress={() =>
                  Alert.alert("Delete record", "Create a delete change request for this record?", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => void deleteRecord() },
                  ])
                }
              />
            </View>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[typography.h2, { color: tokens.foreground }]}>Fields</Text>
          <FieldList fields={record.headCommit.fields} definitions={record.base.fields} />
        </View>

        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[typography.h2, { color: tokens.foreground }]}>Review history</Text>
          {history.length === 0 ? (
            <Text style={[typography.body, { color: tokens.mutedForeground }]}>
              No change requests yet.
            </Text>
          ) : (
            history.map((changeRequest) => (
              <Pressable
                key={changeRequest.id}
                style={[styles.historyRow, { borderColor: tokens.border }]}
                onPress={() =>
                  router.push({
                    pathname: "/change-requests/[id]",
                    params: { id: changeRequest.id },
                  })
                }
              >
                <View style={styles.historyText}>
                  <Text numberOfLines={1} style={[typography.bodyEm, { color: tokens.foreground }]}>
                    {getChangeRequestTitle(changeRequest)}
                  </Text>
                  <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                    {changeRequest.submittedBy} · {formatDate(changeRequest.updatedAt)}
                  </Text>
                </View>
                <StatusBadge status={changeRequest.status} />
              </Pressable>
            ))
          )}
        </View>

        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[typography.h2, { color: tokens.foreground }]}>
            Comments ({comments.length})
          </Text>
          {comments.length === 0 ? (
            <Text style={[typography.body, { color: tokens.mutedForeground }]}>
              No comments yet.
            </Text>
          ) : (
            comments.map((comment) => (
              <View key={comment.id} style={[styles.commentRow, { borderColor: tokens.border }]}>
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
          {commentError ? (
            <Text style={[typography.small, { color: tokens.destructive }]}>{commentError}</Text>
          ) : null}
          <TextInput
            label="Add comment"
            value={commentBody}
            multiline
            style={styles.commentInput}
            textAlignVertical="top"
            placeholder="Write a note for this record (@ai to mention the agent)"
            onChangeText={setCommentBody}
          />
          <Button
            label="Post comment"
            loading={postingComment}
            disabled={commentBody.trim().length === 0}
            fullWidth
            onPress={submitComment}
          />
        </View>
      </View>
    </NativeScreen>
  );
}

export default function RecordDetailScreen() {
  return (
    <ConnectionGuard>
      <RecordDetailContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { marginHorizontal: 20, gap: 14 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 16,
    gap: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  recordActions: { flexDirection: "row", gap: 10 },
  recordActionItem: { flex: 1 },
  historyRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  historyText: { flex: 1, minWidth: 0, gap: 2 },
  commentRow: {
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
  commentInput: { minHeight: 80, paddingTop: 12 },
});
