import type { ChangeRequestVO, OperationVO } from "busabase-core/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Check, CheckCheck, GitMerge, XCircle } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseClient } from "~/api/use-busabase-client";
import { CommentsSection } from "~/components/busabase/CommentsSection";
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
import {
  getChangeRequestTitle,
  getOperationSummary,
  operationLabels,
} from "~/lib/busabase-display";
import { formatDate, shortId } from "~/lib/format";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

type ActionState = "idle" | "approving" | "rejecting" | "merging" | "approving-merging";

function OperationCard({
  operation,
  index,
  onPress,
}: {
  operation: OperationVO;
  index: number;
  onPress: () => void;
}) {
  const tokens = useTokens();
  const label = operationLabels[operation.operation] ?? operation.operation;
  const isDelete = operation.operation.endsWith("_delete");

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: tokens.card, borderColor: tokens.border, opacity: pressed ? 0.78 : 1 },
      ]}
      onPress={onPress}
    >
      <View style={styles.operationHeader}>
        <View
          style={[
            styles.operationBadge,
            {
              backgroundColor: isDelete ? tokens.destructive : tokens.primaryMuted,
            },
          ]}
        >
          <Text
            style={[
              typography.caption,
              { color: isDelete ? tokens.destructiveForeground : tokens.primary },
            ]}
          >
            {index + 1}. {label.toUpperCase()}
          </Text>
        </View>
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {operation.status} · {shortId(operation.headCommitId)}
        </Text>
      </View>
      {operation.headCommit.message ? (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {operation.headCommit.message}
        </Text>
      ) : null}
      <FieldList fields={operation.headCommit.fields} highlight />
    </Pressable>
  );
}

function ChangeRequestDetailContent() {
  const params = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const tokens = useTokens();
  const client = useBusabaseClient();
  const changeRequestId = typeof params.id === "string" ? params.id : "";
  const [changeRequest, setChangeRequest] = useState<ChangeRequestVO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const loadChangeRequest = useCallback(async () => {
    if (!client || !changeRequestId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setChangeRequest(await client.changeRequests.get({ changeRequestId }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load change request");
    } finally {
      setLoading(false);
    }
  }, [client, changeRequestId]);

  useEffect(() => {
    void loadChangeRequest();
  }, [loadChangeRequest]);

  const runAction = async (nextAction: Exclude<ActionState, "idle">) => {
    if (!client || !changeRequestId || !changeRequest) {
      return;
    }

    const previous = changeRequest;
    const optimisticStatus =
      nextAction === "approving" ? "approved" : nextAction === "rejecting" ? "rejected" : "merged";

    setActionState(nextAction);
    setActionError(null);
    // Optimistic status flip; rolled back below if the server rejects the action.
    setChangeRequest({ ...changeRequest, status: optimisticStatus });

    try {
      if (nextAction === "approving") {
        setChangeRequest(
          await client.changeRequests.review({
            changeRequestId,
            verdict: "approved",
          }),
        );
      }
      if (nextAction === "rejecting") {
        setChangeRequest(
          await client.changeRequests.review({
            changeRequestId,
            verdict: "rejected",
            reason: rejectReason.trim() || undefined,
          }),
        );
        setRejectReason("");
      }
      if (nextAction === "merging") {
        const result = await client.changeRequests.merge({ changeRequestId });
        setChangeRequest(result.changeRequest);
      }
      if (nextAction === "approving-merging") {
        await client.changeRequests.review({
          changeRequestId,
          verdict: "approved",
        });
        const result = await client.changeRequests.merge({ changeRequestId });
        setChangeRequest(result.changeRequest);
      }
      setRejectMode(false);
    } catch (caught) {
      setChangeRequest(previous);
      setActionError(
        caught instanceof Error ? caught.message : "Change Request action failed. State restored.",
      );
    } finally {
      setActionState("idle");
    }
  };

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

  if (loading) {
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

  if (error && !changeRequest) {
    return (
      <NativeScreen
        title="Change Request"
        subtitle={shortId(changeRequestId)}
        headerLeading={headerLeading}
      >
        <NativeErrorState message={error} onRetry={loadChangeRequest} />
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

  return (
    <NativeScreen
      title={getChangeRequestTitle(changeRequest)}
      subtitle={`${scopeName} · ${formatDate(changeRequest.updatedAt)}`}
      headerLeading={headerLeading}
    >
      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.statusRow}>
            <StatusBadge status={changeRequest.status} />
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>
              {getOperationSummary(changeRequest)}
            </Text>
          </View>
          <Text style={[typography.body, { color: tokens.mutedForeground }]}>
            Submitted by {changeRequest.submittedBy}
          </Text>
          {changeRequest.rejectedReason ? (
            <Text style={[typography.body, { color: tokens.destructive }]}>
              Changes requested: {changeRequest.rejectedReason}
            </Text>
          ) : null}
        </View>

        <Text style={[typography.h2, { color: tokens.foreground }]}>
          Operations ({operations.length})
        </Text>
        {operations.map((operation, index) => (
          <OperationCard
            key={operation.id}
            operation={operation}
            index={index}
            onPress={() =>
              router.push({
                pathname: "/change-requests/[id]/operations/[operationId]",
                params: { id: changeRequest.id, operationId: operation.id },
              })
            }
          />
        ))}

        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[typography.h2, { color: tokens.foreground }]}>Review history</Text>
          {changeRequest.reviews.length === 0 ? (
            <Text style={[typography.body, { color: tokens.mutedForeground }]}>
              No reviews have been recorded yet.
            </Text>
          ) : (
            changeRequest.reviews.map((review) => (
              <View key={review.id} style={[styles.reviewRow, { borderColor: tokens.border }]}>
                <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
                  {review.verdict}
                </Text>
                <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                  {review.reviewerId} · {formatDate(review.createdAt)}
                </Text>
                {review.reason ? (
                  <Text style={[typography.body, { color: tokens.mutedForeground }]}>
                    {review.reason}
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </View>

        <CommentsSection subjectType="change_request" subjectId={changeRequest.id} />

        {actionError ? (
          <NativeErrorState message={actionError} onRetry={() => setActionError(null)} />
        ) : null}

        {rejectMode ? (
          <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <Text style={[typography.h2, { color: tokens.foreground }]}>Request changes</Text>
            <TextInput
              label="What should change?"
              value={rejectReason}
              multiline
              style={styles.reasonInput}
              textAlignVertical="top"
              placeholder="Describe the revision the agent should make"
              onChangeText={setRejectReason}
            />
            <Button
              label="Send back for changes"
              variant="destructive"
              loading={actionState === "rejecting"}
              fullWidth
              onPress={() => runAction("rejecting")}
            />
            <Button label="Cancel" variant="ghost" fullWidth onPress={() => setRejectMode(false)} />
          </View>
        ) : (
          <View style={styles.actions}>
            {canReview ? (
              <>
                <Button
                  label="Approve"
                  leadingIcon={<Check size={18} color={tokens.primaryForeground} />}
                  loading={actionState === "approving"}
                  disabled={actionState !== "idle"}
                  fullWidth
                  onPress={() => runAction("approving")}
                />
                <Button
                  label="Approve & Merge"
                  leadingIcon={<CheckCheck size={18} color={tokens.primaryForeground} />}
                  loading={actionState === "approving-merging"}
                  disabled={actionState !== "idle"}
                  fullWidth
                  onPress={() => runAction("approving-merging")}
                />
                <Button
                  label="Request changes"
                  variant="destructive"
                  leadingIcon={<XCircle size={18} color={tokens.destructiveForeground} />}
                  disabled={actionState !== "idle"}
                  fullWidth
                  onPress={() => setRejectMode(true)}
                />
              </>
            ) : null}
            {canMerge ? (
              <Button
                label="Merge into Base"
                leadingIcon={<GitMerge size={18} color={tokens.primaryForeground} />}
                loading={actionState === "merging"}
                disabled={actionState !== "idle"}
                fullWidth
                onPress={() => runAction("merging")}
              />
            ) : null}
          </View>
        )}
      </View>
    </NativeScreen>
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
  operationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  operationBadge: {
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reviewRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    gap: 4,
  },
  actions: { gap: 10 },
  reasonInput: { minHeight: 94, paddingTop: 12 },
});
