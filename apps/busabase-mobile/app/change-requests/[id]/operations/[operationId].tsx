import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeRequestVO, OperationVO } from "busabase-contract/types";
import { getChangeRequestScopeName } from "busabase-core/dashboard/change-request";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, GitCommitHorizontal } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeEmptyState,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { FieldList } from "~/domains/base/components/FieldList";
import { RecordForm } from "~/domains/base/components/RecordForm";
import {
  buildInitialFormValues,
  getChangedFieldValues,
  normalizeFormValues,
  type RecordFormValue,
} from "~/domains/base/utils/record-form";
import { CommentsSection } from "~/domains/review/components/CommentsSection";
import { getOperationStatusLabel, operationLabels } from "~/domains/review/utils/busabase-display";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { shortId } from "~/lib/format";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function OperationSummarySection({ operation }: { operation: OperationVO }) {
  const tokens = useTokens();

  return (
    <NativeSection title="Summary">
      <NativeRow
        title={operation.headCommit.message || "No commit message"}
        subtitle={`${getOperationStatusLabel(operation.status)} · Operation ${operation.position + 1}`}
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
        buildInitialFormValues(changeRequest.base?.fields ?? [], operation.headCommit.payload),
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
      <DrawerScaffold
        title="Operation"
        subtitle={shortId(operationId)}
        headerLeading={headerLeading}
      >
        <NativeLoadingState label="Loading operation" />
      </DrawerScaffold>
    );
  }

  if (!changeRequest || !operation) {
    return (
      <DrawerScaffold
        title="Operation"
        subtitle={shortId(operationId)}
        headerLeading={headerLeading}
      >
        <NativeEmptyState
          title="Operation not found"
          description="This operation is not available."
        />
      </DrawerScaffold>
    );
  }

  const label = operationLabels[operation.operation] ?? operation.operation;
  const changedFields = getChangedFieldValues(operation.baseFields, operation.headCommit.payload);
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
    <DrawerScaffold
      title={label}
      subtitle={`${getChangeRequestScopeName(changeRequest)} · ${shortId(operation.headCommitId)}`}
      headerLeading={headerLeading}
      footer={footer}
    >
      <OperationSummarySection operation={operation} />
      <NativeSection title="Changes">
        <FieldList
          fields={changedFields}
          definitions={changeRequest.base?.fields ?? []}
          highlight
          variant="grouped"
        />
      </NativeSection>

      <CommentsSection subjectType="operation" subjectId={operation.id} />
      <NativeBottomSheet
        visible={revisionOpen}
        title="Revise operation"
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
            onChange={(slug, value) => setValues((current) => ({ ...current, [slug]: value }))}
          />
        </ScrollView>
      </NativeBottomSheet>
    </DrawerScaffold>
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
