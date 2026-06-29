import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeRequestVO, OperationVO } from "busabase-core/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { CommentsSection } from "~/components/busabase/CommentsSection";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { FieldList } from "~/components/busabase/FieldList";
import { RecordForm } from "~/components/busabase/RecordForm";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeScreen,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { StatusBadge } from "~/components/ui/StatusBadge";
import { getChangeRequestScopeName, operationLabels } from "~/lib/busabase-display";
import { shortId } from "~/lib/format";
import {
  buildInitialFormValues,
  normalizeFormValues,
  type RecordFormValue,
} from "~/lib/record-form";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function OperationDetailContent() {
  const params = useLocalSearchParams<{ id?: string; operationId?: string }>();
  const changeRequestId = typeof params.id === "string" ? params.id : "";
  const operationId = typeof params.operationId === "string" ? params.operationId : "";
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const [reviseMode, setReviseMode] = useState(false);
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
      setReviseMode(false);
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

  return (
    <NativeScreen
      title={label}
      subtitle={`${getChangeRequestScopeName(changeRequest)} · ${shortId(operation.headCommitId)}`}
      headerLeading={headerLeading}
    >
      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.row}>
            <StatusBadge status={changeRequest.status} />
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>
              {operation.status} · position {operation.position + 1}
            </Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[typography.h2, { color: tokens.foreground }]}>Proposed fields</Text>
          <FieldList
            fields={operation.headCommit.fields}
            definitions={changeRequest.base?.fields ?? []}
            highlight
          />
        </View>

        {reviseMode ? (
          <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <Text style={[typography.h2, { color: tokens.foreground }]}>Revise operation</Text>
            <RecordForm
              fields={changeRequest.base?.fields ?? []}
              values={values}
              onChange={(slug, value) => setValues((current) => ({ ...current, [slug]: value }))}
            />
            {reviseMutation.error ? (
              <NativeErrorState
                message={reviseMutation.error.message}
                onRetry={() => reviseMutation.reset()}
              />
            ) : null}
            <Button
              label="Submit revision"
              loading={reviseMutation.isPending}
              fullWidth
              onPress={() => reviseMutation.mutate()}
            />
            <Button label="Cancel" variant="ghost" fullWidth onPress={() => setReviseMode(false)} />
          </View>
        ) : changeRequest.status === "in_review" ? (
          <Button
            label="Revise operation"
            variant="secondary"
            fullWidth
            onPress={() => setReviseMode(true)}
          />
        ) : null}

        <CommentsSection subjectType="operation" subjectId={operation.id} />
      </View>
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
  content: { marginHorizontal: 20, gap: 14 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 16,
    gap: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
});
