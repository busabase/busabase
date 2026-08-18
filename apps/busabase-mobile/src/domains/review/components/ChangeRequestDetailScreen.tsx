import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeRequestVO } from "busabase-contract/types";
import { getChangeRequestTitle } from "busabase-core/dashboard/change-request";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeEmptyState,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { formatDate, shortId } from "~/lib/format";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import {
  ChangeRequestOperationsSection,
  ChangeRequestSummarySection,
  ReviewActionBar,
  ReviewHistorySection,
} from "./ChangeRequestDetailSections";
import { CommentsSection } from "./CommentsSection";

type ReviewVerdict = "approved" | "rejected";

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
      return buda.client.changeRequests.review({
        changeRequestIds: [changeRequestId],
        verdict,
        reason,
      });
    },
    onSuccess: () => void invalidateCR(),
  });

  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error("Not connected");
      return buda.client.changeRequests.merge({ changeRequestIds: [changeRequestId] });
    },
    onSuccess: () => void invalidateCR(),
  });

  const approveMergeMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error("Not connected");
      await buda.client.changeRequests.review({
        changeRequestIds: [changeRequestId],
        verdict: "approved",
      });
      return buda.client.changeRequests.merge({ changeRequestIds: [changeRequestId] });
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
      <DrawerScaffold title="Change Request" headerLeading={headerLeading}>
        <NativeLoadingState label="Loading change request" />
      </DrawerScaffold>
    );
  }

  if (crQuery.error && !changeRequest) {
    return (
      <DrawerScaffold
        title="Change Request"
        subtitle={shortId(changeRequestId)}
        headerLeading={headerLeading}
      >
        <NativeErrorState message={crQuery.error.message} onRetry={() => void crQuery.refetch()} />
      </DrawerScaffold>
    );
  }

  if (!changeRequest) {
    return (
      <DrawerScaffold
        title="Change Request"
        subtitle={shortId(changeRequestId)}
        headerLeading={headerLeading}
      >
        <NativeEmptyState
          title="Change Request not found"
          description="This change request is no longer available."
        />
      </DrawerScaffold>
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
    <DrawerScaffold
      title={getChangeRequestTitle(changeRequest)}
      titleNumberOfLines={2}
      subtitle={`${scopeName} · ${formatDate(changeRequest.updatedAt)}`}
      headerLeading={headerLeading}
      footer={footer}
    >
      <ChangeRequestSummarySection changeRequest={changeRequest} />
      <ChangeRequestOperationsSection
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
    </DrawerScaffold>
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
  reasonInput: { minHeight: 94, paddingTop: 12 },
});
