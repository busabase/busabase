import type { ChangeRequestVO, OperationVO } from "busabase-contract/types";
import { getChangeRequestSummary } from "busabase-core/dashboard/change-request";
import {
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
import { Text } from "react-native";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeInlineError,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { formatDate, shortId } from "~/lib/format";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import {
  getChangeRequestReviewCue,
  getOperationStatusLabel,
  operationLabels,
} from "../utils/busabase-display";
import { getStatusLabel, StatusBadge } from "./StatusBadge";

export function ReviewHistorySection({ changeRequest }: { changeRequest: ChangeRequestVO }) {
  const tokens = useTokens();

  return (
    <NativeSection title="Review history" caption={`${changeRequest.reviews.length}`}>
      {changeRequest.reviews.length === 0 ? (
        <NativeRow
          title="No reviews yet"
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

export function ChangeRequestSummarySection({ changeRequest }: { changeRequest: ChangeRequestVO }) {
  const tokens = useTokens();
  return (
    <NativeSection title="Summary">
      <NativeRow
        title={getChangeRequestReviewCue(changeRequest)}
        subtitle={`${getChangeRequestSummary(changeRequest)} · submitted by ${changeRequest.submittedBy}`}
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

export function ChangeRequestOperationsSection({
  operations,
  onOpenOperation,
}: {
  operations: OperationVO[];
  onOpenOperation: (operation: OperationVO) => void;
}) {
  const tokens = useTokens();
  return (
    <NativeSection title="Operations" caption={`${operations.length}`}>
      {operations.length === 0 ? <NativeRow title="No operations" last /> : null}
      {operations.map((operation, index) => {
        const label = operationLabels[operation.operation] ?? operation.operation;
        const isDelete = operation.operation.endsWith("_delete");
        return (
          <NativeRow
            key={operation.id}
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
            onPress={() => onOpenOperation(operation)}
            last={index === operations.length - 1}
          />
        );
      })}
    </NativeSection>
  );
}

interface ReviewActionBarProps {
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
}

export function ReviewActionBar({
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
}: ReviewActionBarProps) {
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
