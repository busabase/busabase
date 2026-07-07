import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeRequestVO, OperationVO } from "busabase-contract/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  GitCommitHorizontal,
  GitMerge,
  History,
  MoreHorizontal,
  UserRound,
  XCircle,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
import { TextInput } from "~/components/ui/TextInput";
import {
  getChangeRequestReviewCue,
  getChangeRequestTitle,
  getOperationStatusLabel,
  getOperationSummary,
  operationLabels,
} from "~/lib/busabase-display";
import { formatDate, shortId } from "~/lib/format";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

type ReviewVerdict = "approved" | "rejected";

function OperationRow({
  operation,
  index,
  last,
  onPress,
}: {
  operation: OperationVO;
  index: number;
  last: boolean;
  onPress: () => void;
}) {
  const tokens = useTokens();
  const label = operationLabels[operation.operation] ?? operation.operation;
  const isDelete = operation.operation.endsWith("_delete");

  return (
    <NativeRow
      title={`${index + 1}. ${label}`}
      subtitle={operation.headCommit.message || getOperationStatusLabel(operation.status)}
      meta={shortId(operation.headCommitId)}
      leading={
        <GitCommitHorizontal
          size={18}
          color={isDelete ? tokens.destructive : tokens.mutedForeground}
        />
      }
      destructive={isDelete}
      last={last}
      onPress={onPress}
    >
      <View style={styles.operationFields}>
        <FieldList fields={operation.headCommit.fields} highlight variant="compact" />
      </View>
    </NativeRow>
  );
}

function ReviewHistorySection({ changeRequest }: { changeRequest: ChangeRequestVO }) {
  const tokens = useTokens();

  return (
    <NativeSection title="Review history" caption={`${changeRequest.reviews.length}`}>
      {changeRequest.reviews.length === 0 ? (
        <NativeRow
          title="No reviews yet"
          subtitle="Approvals and requested changes will appear here."
          leading={<History size={18} color={tokens.mutedForeground} />}
          last
        />
      ) : (
        changeRequest.reviews.map((review, index) => (
          <NativeRow
            key={review.id}
            title={getStatusLabel(review.verdict)}
            subtitle={`${review.reviewerId} · ${formatDate(review.createdAt)}`}
            leading={<UserRound size={18} color={tokens.mutedForeground} />}
            last={index === changeRequest.reviews.length - 1}
          >
            {review.reason ? (
              <Text style={[typography.body, { color: tokens.mutedForeground }]}>
                {review.reason}
              </Text>
            ) : null}
          </NativeRow>
        ))
      )}
    </NativeSection>
  );
}

function SummarySection({ changeRequest }: { changeRequest: ChangeRequestVO }) {
  const tokens = useTokens();
  const reviewCue = getChangeRequestReviewCue(changeRequest);
  const operationSummary = getOperationSummary(changeRequest);

  return (
    <NativeSection title="Summary">
      <NativeRow
        title={reviewCue}
        subtitle={`${operationSummary} · submitted by ${changeRequest.submittedBy}`}
        trailing={<StatusBadge status={changeRequest.status} />}
        last={!changeRequest.rejectedReason}
      />
      {changeRequest.rejectedReason ? (
        <NativeRow
          title="Changes requested"
          subtitle={changeRequest.rejectedReason}
          destructive
          leading={<XCircle size={18} color={tokens.destructive} />}
          last
        />
      ) : null}
    </NativeSection>
  );
}

function OperationsSection({
  operations,
  onOpenOperation,
}: {
  operations: OperationVO[];
  onOpenOperation: (operation: OperationVO) => void;
}) {
  return (
    <NativeSection title="Operations" caption={`${operations.length}`}>
      {operations.length === 0 ? (
        <NativeRow title="No operations" subtitle="This change request has no operations." last />
      ) : (
        operations.map((operation, index) => (
          <OperationRow
            key={operation.id}
            operation={operation}
            index={index}
            last={index === operations.length - 1}
            onPress={() => onOpenOperation(operation)}
          />
        ))
      )}
    </NativeSection>
  );
}

function ChangeRequestDetailContent() {
  const params = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const changeRequestId = typeof params.id === "string" ? params.id : "";
  const [rejectMode, setRejectMode] = useState(false);
  const [discardRejectOpen, setDiscardRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const crQuery = useQuery(
    buda && changeRequestId
      ? buda.orpc.changeRequests.get.queryOptions({ input: { changeRequestId } })
      : { queryKey: ["no-connection", "change-request", changeRequestId], queryFn: skipToken },
  );
  const changeRequest = (crQuery.data as ChangeRequestVO | undefined) ?? null;

  const invalidateCR = () =>
    queryClient.invalidateQueries({
      queryKey: buda?.orpc.changeRequests.get.key({ input: { changeRequestId } }),
    });

  const reviewMutation = useMutation({
    mutationFn: async ({ verdict, reason }: { verdict: ReviewVerdict; reason?: string }) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.changeRequests.review({ changeRequestId, verdict, reason });
    },
    onSuccess: () => void invalidateCR(),
  });

  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error("Not connected");
      return buda.client.changeRequests.merge({ changeRequestId });
    },
    onSuccess: () => void invalidateCR(),
  });

  const approveMergeMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error("Not connected");
      await buda.client.changeRequests.review({ changeRequestId, verdict: "approved" });
      return buda.client.changeRequests.merge({ changeRequestId });
    },
    onSuccess: () => void invalidateCR(),
  });

  const actionError =
    reviewMutation.error?.message ??
    mergeMutation.error?.message ??
    approveMergeMutation.error?.message ??
    null;
  const anyPending =
    reviewMutation.isPending || mergeMutation.isPending || approveMergeMutation.isPending;

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/drawer/inbox"))}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  if (crQuery.isLoading) {
    return (
      <NativeScreen
        title="Change Request"
        subtitle="Loading review detail"
        headerLeading={headerLeading}
      >
        <NativeLoadingState label="Loading change request" />
      </NativeScreen>
    );
  }

  if (crQuery.error && !changeRequest) {
    return (
      <NativeScreen
        title="Change Request"
        subtitle={shortId(changeRequestId)}
        headerLeading={headerLeading}
      >
        <NativeErrorState message={crQuery.error.message} onRetry={() => void crQuery.refetch()} />
      </NativeScreen>
    );
  }

  if (!changeRequest) {
    return (
      <NativeScreen
        title="Change Request"
        subtitle={shortId(changeRequestId)}
        headerLeading={headerLeading}
      >
        <NativeEmptyState
          title="Change Request not found"
          description="This change request is no longer available."
        />
      </NativeScreen>
    );
  }

  const canReview = changeRequest.status === "in_review";
  const canMerge = changeRequest.status === "approved";
  const operations = [...changeRequest.operations].sort((a, b) => a.position - b.position);
  const scopeName = changeRequest.base?.name ?? changeRequest.node?.name ?? "Node tree";
  const rejectSheetVisible = rejectMode && !discardRejectOpen;
  const closeRejectSheet = () => {
    if (reviewMutation.isPending) {
      return;
    }
    if (rejectReason.trim()) {
      setDiscardRejectOpen(true);
      return;
    }
    setRejectMode(false);
  };
  const discardRejectReason = () => {
    if (reviewMutation.isPending) {
      return;
    }
    setRejectReason("");
    setRejectMode(false);
    setDiscardRejectOpen(false);
    reviewMutation.reset();
  };
  const footer =
    canReview || canMerge || actionError ? (
      <ReviewActionBar
        actionError={actionError}
        anyPending={anyPending}
        canMerge={canMerge}
        canReview={canReview}
        onApprove={() => reviewMutation.mutate({ verdict: "approved" })}
        onApproveMerge={() => approveMergeMutation.mutate()}
        onMerge={() => mergeMutation.mutate()}
        onResetError={() => {
          reviewMutation.reset();
          mergeMutation.reset();
          approveMergeMutation.reset();
        }}
        onRequestChanges={() => setRejectMode(true)}
        approveLoading={reviewMutation.isPending}
        approveMergeLoading={approveMergeMutation.isPending}
        mergeLoading={mergeMutation.isPending}
      />
    ) : undefined;

  return (
    <NativeScreen
      title={getChangeRequestTitle(changeRequest)}
      subtitle={`${scopeName} · ${formatDate(changeRequest.updatedAt)}`}
      headerLeading={headerLeading}
      footer={footer}
    >
      <SummarySection changeRequest={changeRequest} />
      <OperationsSection
        operations={operations}
        onOpenOperation={(operation) =>
          router.push({
            pathname: "/change-requests/[id]/operations/[operationId]",
            params: { id: changeRequest.id, operationId: operation.id },
          })
        }
      />
      <ReviewHistorySection changeRequest={changeRequest} />
      <CommentsSection subjectType="change_request" subjectId={changeRequest.id} />
      <NativeBottomSheet
        visible={rejectSheetVisible}
        title="Request changes"
        description="Tell the submitter or agent what needs to change before this can be approved."
        showCloseButton
        onClose={closeRejectSheet}
        footer={
          <NativeActionBar>
            {reviewMutation.error ? (
              <NativeInlineError
                message={reviewMutation.error.message}
                onReset={() => reviewMutation.reset()}
              />
            ) : null}
            <Button
              label="Send back for changes"
              variant="destructive"
              loading={reviewMutation.isPending}
              disabled={reviewMutation.isPending}
              fullWidth
              onPress={() =>
                reviewMutation.mutate(
                  { verdict: "rejected", reason: rejectReason.trim() || undefined },
                  {
                    onSuccess: () => {
                      setRejectMode(false);
                      setRejectReason("");
                    },
                  },
                )
              }
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={reviewMutation.isPending}
              fullWidth
              onPress={closeRejectSheet}
            />
          </NativeActionBar>
        }
      >
        <TextInput
          label="What should change?"
          value={rejectReason}
          multiline
          style={styles.reasonInput}
          textAlignVertical="top"
          placeholder="Describe the revision the agent should make"
          onChangeText={setRejectReason}
        />
      </NativeBottomSheet>
      <NativeBottomSheet
        visible={discardRejectOpen}
        title="Discard request?"
        description="This closes the request changes sheet and removes the unsent reason."
        showCloseButton
        onClose={() => setDiscardRejectOpen(false)}
        footer={
          <NativeActionBar>
            <Button
              label="Discard reason"
              variant="destructive"
              disabled={reviewMutation.isPending}
              fullWidth
              onPress={discardRejectReason}
            />
            <Button
              label="Keep editing"
              variant="ghost"
              disabled={reviewMutation.isPending}
              fullWidth
              onPress={() => setDiscardRejectOpen(false)}
            />
          </NativeActionBar>
        }
      />
    </NativeScreen>
  );
}

function ReviewActionBar({
  actionError,
  anyPending,
  approveLoading,
  approveMergeLoading,
  canMerge,
  canReview,
  mergeLoading,
  onApprove,
  onApproveMerge,
  onMerge,
  onRequestChanges,
  onResetError,
}: {
  actionError: string | null;
  anyPending: boolean;
  approveLoading: boolean;
  approveMergeLoading: boolean;
  canMerge: boolean;
  canReview: boolean;
  mergeLoading: boolean;
  onApprove: () => void;
  onApproveMerge: () => void;
  onMerge: () => void;
  onRequestChanges: () => void;
  onResetError: () => void;
}) {
  const tokens = useTokens();
  const [optionsOpen, setOptionsOpen] = useState(false);

  return (
    <NativeActionBar>
      {actionError ? <NativeInlineError message={actionError} onReset={onResetError} /> : null}
      {canReview ? (
        <>
          <Button
            label="Approve & Merge"
            leadingIcon={<CheckCheck size={18} color={tokens.primaryForeground} />}
            loading={approveMergeLoading}
            disabled={anyPending}
            fullWidth
            onPress={onApproveMerge}
          />
          <Button
            label="Review options"
            variant="ghost"
            leadingIcon={<MoreHorizontal size={18} color={tokens.foreground} />}
            disabled={anyPending}
            fullWidth
            onPress={() => setOptionsOpen(true)}
          />
          <NativeBottomSheet
            visible={optionsOpen}
            title="Review options"
            description="Approve without merging, or send the change request back for revision."
            showCloseButton
            onClose={() => setOptionsOpen(false)}
            footer={
              <NativeActionBar>
                <Button
                  label="Approve only"
                  leadingIcon={<Check size={18} color={tokens.primaryForeground} />}
                  loading={approveLoading}
                  disabled={anyPending}
                  fullWidth
                  onPress={() => {
                    setOptionsOpen(false);
                    onApprove();
                  }}
                />
                <Button
                  label="Request changes"
                  variant="destructive"
                  leadingIcon={<XCircle size={18} color={tokens.destructiveForeground} />}
                  disabled={anyPending}
                  fullWidth
                  onPress={() => {
                    setOptionsOpen(false);
                    onRequestChanges();
                  }}
                />
                <Button
                  label="Close"
                  variant="ghost"
                  disabled={anyPending}
                  fullWidth
                  onPress={() => setOptionsOpen(false)}
                />
              </NativeActionBar>
            }
          />
        </>
      ) : null}
      {canMerge ? (
        <Button
          label="Merge into Base"
          leadingIcon={<GitMerge size={18} color={tokens.primaryForeground} />}
          loading={mergeLoading}
          disabled={anyPending}
          fullWidth
          onPress={onMerge}
        />
      ) : null}
    </NativeActionBar>
  );
}

export default function ChangeRequestDetailScreen() {
  return (
    <ConnectionGuard>
      <ChangeRequestDetailContent />
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
  operationFields: {
    marginTop: 6,
  },
  reasonInput: { minHeight: 94, paddingTop: 12 },
});
