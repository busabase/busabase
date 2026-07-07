import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeRequestVO, OperationVO } from "busabase-contract/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, GitCommitHorizontal, ListChecks } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { CommentsSection } from "~/components/busabase/CommentsSection";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { FieldList } from "~/components/busabase/FieldList";
import { RecordForm } from "~/components/busabase/RecordForm";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeEmptyState,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
  NativeScreen,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { StatusBadge } from "~/components/ui/StatusBadge";
import {
  getChangeRequestScopeName,
  getOperationStatusLabel,
  operationLabels,
} from "~/lib/busabase-display";
import { shortId } from "~/lib/format";
import {
  buildInitialFormValues,
  normalizeFormValues,
  type RecordFormValue,
} from "~/lib/record-form";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function OperationSummarySection({
  changeRequest,
  operation,
  label,
}: {
  changeRequest: ChangeRequestVO;
  operation: OperationVO;
  label: string;
}) {
  const tokens = useTokens();

  return (
    <NativeSection title="Summary">
      <NativeRow
        title={label}
        subtitle={`${getOperationStatusLabel(operation.status)} · position ${operation.position + 1}`}
        leading={<ListChecks size={18} color={tokens.mutedForeground} />}
        trailing={<StatusBadge status={changeRequest.status} />}
      />
      <NativeRow
        title="Head commit"
        subtitle={operation.headCommit.message || "No commit message"}
        meta={shortId(operation.headCommitId)}
        leading={<GitCommitHorizontal size={18} color={tokens.mutedForeground} />}
        last
      />
    </NativeSection>
  );
}

function OperationDetailContent() {
  const params = useLocalSearchParams<{ id?: string; operationId?: string }>();
  const changeRequestId = typeof params.id === "string" ? params.id : "";
  const operationId = typeof params.operationId === "string" ? params.operationId : "";
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [values, setValues] = useState<Record<string, RecordFormValue>>({});

  const crQuery = useQuery(
    buda && changeRequestId
      ? buda.orpc.changeRequests.get.queryOptions({ input: { changeRequestId } })
      : { queryKey: ["no-connection", "change-request", changeRequestId], queryFn: skipToken },
  );
  const changeRequest = (crQuery.data as ChangeRequestVO | undefined) ?? null;
  const operation =
    (changeRequest?.operations.find((item) => item.id === operationId) as
      | OperationVO
      | undefined) ?? null;

  useEffect(() => {
    if (operation && changeRequest) {
      setValues(
        buildInitialFormValues(changeRequest.base?.fields ?? [], operation.headCommit.fields),
      );
    }
  }, [operation, changeRequest]);

  const reviseMutation = useMutation({
    mutationFn: async () => {
      if (!buda || !changeRequest || !operation) throw new Error("Not ready");
      return buda.client.operations.revise({
        operationId: operation.id,
        fields: normalizeFormValues(changeRequest.base?.fields ?? [], values),
        message: "Revise operation",
        author: "mobile-editor",
      });
    },
    onSuccess: () => {
      setRevisionOpen(false);
      void queryClient.invalidateQueries({
        queryKey: buda?.orpc.changeRequests.get.key({ input: { changeRequestId } }),
      });
    },
  });

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
      <NativeScreen title="Operation" subtitle={shortId(operationId)} headerLeading={headerLeading}>
        <NativeLoadingState label="Loading operation" />
      </NativeScreen>
    );
  }

  if (!changeRequest || !operation) {
    return (
      <NativeScreen title="Operation" subtitle={shortId(operationId)} headerLeading={headerLeading}>
        <NativeEmptyState
          title="Operation not found"
          description="This operation is not available."
        />
      </NativeScreen>
    );
  }

  const label = operationLabels[operation.operation] ?? operation.operation;
  const footer =
    changeRequest.status === "in_review" ? (
      <NativeActionBar>
        <Button
          label="Revise operation"
          variant="secondary"
          disabled={revisionOpen}
          fullWidth
          onPress={() => {
            reviseMutation.reset();
            setRevisionOpen(true);
          }}
        />
      </NativeActionBar>
    ) : undefined;

  return (
    <NativeScreen
      title={label}
      subtitle={`${getChangeRequestScopeName(changeRequest)} · ${shortId(operation.headCommitId)}`}
      headerLeading={headerLeading}
      footer={footer}
    >
      <OperationSummarySection changeRequest={changeRequest} operation={operation} label={label} />
      <NativeSection title="Proposed fields">
        <FieldList
          fields={operation.headCommit.fields}
          definitions={changeRequest.base?.fields ?? []}
          highlight
        />
      </NativeSection>

      <CommentsSection subjectType="operation" subjectId={operation.id} />
      <NativeBottomSheet
        visible={revisionOpen}
        title="Revise operation"
        description="Adjust the proposed fields and submit a new operation revision."
        showCloseButton
        maxHeight="88%"
        onClose={() => setRevisionOpen(false)}
        footer={
          <NativeActionBar>
            {reviseMutation.error ? (
              <NativeInlineError
                message={reviseMutation.error.message}
                onReset={() => reviseMutation.reset()}
              />
            ) : null}
            <Button
              label="Submit revision"
              loading={reviseMutation.isPending}
              fullWidth
              onPress={() => reviseMutation.mutate()}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={reviseMutation.isPending}
              fullWidth
              onPress={() => setRevisionOpen(false)}
            />
          </NativeActionBar>
        }
      >
        <ScrollView
          style={styles.revisionSheetScroll}
          contentContainerStyle={styles.revisionSheetContent}
          keyboardShouldPersistTaps="handled"
        >
          <RecordForm
            fields={changeRequest.base?.fields ?? []}
            values={values}
            variant="embedded"
            onChange={(slug, value) => setValues((current) => ({ ...current, [slug]: value }))}
          />
        </ScrollView>
      </NativeBottomSheet>
    </NativeScreen>
  );
}

export default function OperationDetailScreen() {
  return (
    <ConnectionGuard>
      <OperationDetailContent />
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
  revisionSheetScroll: { maxHeight: 440 },
  revisionSheetContent: { paddingBottom: 8 },
});
