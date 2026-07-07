import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import type { ChangeRequestVO } from "busabase-contract/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, GitPullRequest, MoreHorizontal, Pencil, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { CommentsSection } from "~/components/busabase/CommentsSection";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { FieldList } from "~/components/busabase/FieldList";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeEmptyState,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
  NativeScreen,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { getStatusLabel, StatusBadge } from "~/components/ui/StatusBadge";
import { getChangeRequestTitle, getRecordTitle } from "~/lib/busabase-display";
import { formatDate, shortId } from "~/lib/format";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function RecordDetailContent() {
  const params = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const recordId = typeof params.id === "string" ? params.id : "";
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);

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

  const record = recordQuery.data ?? null;
  const history = (historyQuery.data as ChangeRequestVO[] | undefined) ?? [];

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
      setDeleteSheetOpen(false);
      router.replace({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
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
      headerAction={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open record actions"
          hitSlop={mobile.hitSlop}
          style={[styles.moreButton, { backgroundColor: tokens.primaryMuted }]}
          onPress={() => setActionsSheetOpen(true)}
        >
          <MoreHorizontal size={21} color={tokens.foreground} />
        </Pressable>
      }
      footer={
        <NativeActionBar>
          {deleteMutation.error ? (
            <NativeInlineError
              message={deleteMutation.error.message}
              onReset={() => deleteMutation.reset()}
            />
          ) : null}
          <Button
            label="Edit record"
            variant="secondary"
            fullWidth
            leadingIcon={<Pencil size={18} color={tokens.foreground} />}
            onPress={() =>
              router.push({ pathname: "/records/[id]/edit", params: { id: record.id } })
            }
          />
        </NativeActionBar>
      }
    >
      <NativeSection title="Status">
        <NativeRow
          title={getStatusLabel(record.status)}
          subtitle={`Commit ${shortId(record.headCommitId)} · by ${record.createdBy}`}
          trailing={<StatusBadge status={record.status} />}
          last
        />
      </NativeSection>

      <NativeSection title="Fields">
        <FieldList
          fields={record.headCommit.fields}
          definitions={record.base.fields}
          variant="grouped"
        />
      </NativeSection>

      <NativeSection title="Review history" caption={`${history.length}`}>
        {history.length === 0 ? (
          <NativeRow
            title="No change requests yet"
            subtitle="Edits to this record will appear here as review history."
            leading={<GitPullRequest size={18} color={tokens.mutedForeground} />}
            last
          />
        ) : (
          history.map((changeRequest, index) => (
            <NativeRow
              key={changeRequest.id}
              title={getChangeRequestTitle(changeRequest)}
              subtitle={`${changeRequest.submittedBy} · ${formatDate(changeRequest.updatedAt)}`}
              trailing={<StatusBadge status={changeRequest.status} />}
              last={index === history.length - 1}
              onPress={() =>
                router.push({
                  pathname: "/change-requests/[id]",
                  params: { id: changeRequest.id },
                })
              }
            />
          ))
        )}
      </NativeSection>

      <CommentsSection subjectType="record" subjectId={record.id} />

      <NativeBottomSheet
        visible={actionsSheetOpen}
        title="Record actions"
        description="Manage this record without crowding the reading view."
        showCloseButton
        onClose={() => setActionsSheetOpen(false)}
        footer={
          <NativeActionBar>
            <Button
              label="Edit record"
              variant="secondary"
              fullWidth
              leadingIcon={<Pencil size={18} color={tokens.foreground} />}
              onPress={() => {
                setActionsSheetOpen(false);
                router.push({ pathname: "/records/[id]/edit", params: { id: record.id } });
              }}
            />
            <Button
              label="Create delete change request"
              variant="destructive"
              loading={deleteMutation.isPending}
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={() => {
                setActionsSheetOpen(false);
                setDeleteSheetOpen(true);
              }}
            />
            <Button
              label="Close"
              variant="ghost"
              disabled={deleteMutation.isPending}
              fullWidth
              onPress={() => setActionsSheetOpen(false)}
            />
          </NativeActionBar>
        }
      />

      <NativeBottomSheet
        visible={deleteSheetOpen}
        title="Delete record?"
        description="This creates a delete change request. The canonical record changes only after the request is reviewed and merged."
        showCloseButton
        onClose={() => setDeleteSheetOpen(false)}
        footer={
          <NativeActionBar>
            {deleteMutation.error ? (
              <NativeInlineError
                message={deleteMutation.error.message}
                onReset={() => deleteMutation.reset()}
              />
            ) : null}
            <Button
              label="Create delete change request"
              variant="destructive"
              loading={deleteMutation.isPending}
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={() => deleteMutation.mutate()}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={deleteMutation.isPending}
              fullWidth
              onPress={() => setDeleteSheetOpen(false)}
            />
          </NativeActionBar>
        }
      />
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
  moreButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
