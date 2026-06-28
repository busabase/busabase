import type { ChangeRequestVO, OperationVO } from "busabase-core/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseClient } from "~/api/use-busabase-client";
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
  const client = useBusabaseClient();

  const [changeRequest, setChangeRequest] = useState<ChangeRequestVO | null>(null);
  const [operation, setOperation] = useState<OperationVO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviseMode, setReviseMode] = useState(false);
  const [values, setValues] = useState<Record<string, RecordFormValue>>({});
  const [revising, setRevising] = useState(false);

  const load = useCallback(async () => {
    if (!client || !changeRequestId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const cr = await client.changeRequests.get({ changeRequestId });
      const op = cr.operations.find((item) => item.id === operationId) ?? null;
      setChangeRequest(cr);
      setOperation(op);
      if (op) {
        setValues(buildInitialFormValues(cr.base?.fields ?? [], op.headCommit.fields));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load operation");
    } finally {
      setLoading(false);
    }
  }, [client, changeRequestId, operationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitRevision = async () => {
    if (!client || !changeRequest || !operation) {
      return;
    }
    setRevising(true);
    setError(null);
    try {
      const updated = await client.operations.revise({
        operationId: operation.id,
        fields: normalizeFormValues(changeRequest.base?.fields ?? [], values),
        message: "Revise operation",
        author: "mobile-editor",
      });
      setChangeRequest(updated);
      setOperation(updated.operations.find((item) => item.id === operationId) ?? null);
      setReviseMode(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revise operation");
    } finally {
      setRevising(false);
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
            <Button label="Submit revision" loading={revising} fullWidth onPress={submitRevision} />
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

        {error ? <NativeErrorState message={error} onRetry={() => setError(null)} /> : null}

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
