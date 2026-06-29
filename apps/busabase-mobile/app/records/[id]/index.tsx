import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeRequestVO } from "busabase-core/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
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
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const recordId = typeof params.id === "string" ? params.id : "";
  const [commentBody, setCommentBody] = useState("");

  const recordQuery = useQuery(
    buda && recordId
      ? buda.orpc.records.get.queryOptions({ input: { recordId } })
      : { queryKey: ["no-connection", "record", recordId], queryFn: skipToken },
  );
  const historyQuery = useQuery(
    buda && recordId
      ? buda.orpc.records.listChangeRequests.queryOptions({ input: { recordId } })
      : { queryKey: ["no-connection", "record-history", recordId], queryFn: skipToken },
  );
  const commentsQuery = useQuery(
    buda && recordId
      ? buda.orpc.comments.list.queryOptions({
          input: { subjectType: "record", subjectId: recordId },
        })
      : { queryKey: ["no-connection", "comments", "record", recordId], queryFn: skipToken },
  );

  const record = recordQuery.data ?? null;
  const history = (historyQuery.data as ChangeRequestVO[] | undefined) ?? [];
  const comments = commentsQuery.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!buda || !recordId) throw new Error("Not connected");
      return buda.client.records.deleteChangeRequest({
        recordId,
        message: "Delete record",
        submittedBy: "mobile-editor",
      });
    },
    onSuccess: (changeRequest) => {
      router.replace({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async (body: string) => {
      if (!buda || !recordId) throw new Error("Not connected");
      return buda.client.comments.create({
        subjectType: "record",
        subjectId: recordId,
        body,
        authorId: "mobile-reviewer",
        mentionsAi: /(^|\s)@ai(\s|$)/i.test(body),
      });
    },
    onSuccess: () => {
      setCommentBody("");
      void queryClient.invalidateQueries({
        queryKey: buda?.orpc.comments.list.key({
          input: { subjectType: "record", subjectId: recordId },
        }),
      });
    },
  });

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

  if (recordQuery.isLoading) {
    return (
      <NativeScreen title="Record" subtitle="Loading record" headerLeading={headerLeading}>
        <NativeLoadingState label="Loading record" />
      </NativeScreen>
    );
  }

  if (recordQuery.error && !record) {
    return (
      <NativeScreen title="Record" subtitle={shortId(recordId)} headerLeading={headerLeading}>
        <NativeErrorState
          message={recordQuery.error.message}
          onRetry={() => void recordQuery.refetch()}
        />
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
                label="Delete"
                variant="destructive"
                loading={deleteMutation.isPending}
                fullWidth
                onPress={() =>
                  Alert.alert("Delete record", "Create a delete change request for this record?", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => deleteMutation.mutate(),
                    },
                  ])
                }
              />
            </View>
          </View>
          {deleteMutation.error ? (
            <Text style={[typography.small, { color: tokens.destructive }]}>
              {deleteMutation.error.message}
            </Text>
          ) : null}
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
          {commentsQuery.isLoading ? (
            <Text style={[typography.body, { color: tokens.mutedForeground }]}>
              Loading comments...
            </Text>
          ) : comments.length === 0 ? (
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
          {commentMutation.error ? (
            <Text style={[typography.small, { color: tokens.destructive }]}>
              {commentMutation.error.message}
            </Text>
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
            loading={commentMutation.isPending}
            disabled={commentBody.trim().length === 0}
            fullWidth
            onPress={() => {
              const body = commentBody.trim();
              if (body) commentMutation.mutate(body);
            }}
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
