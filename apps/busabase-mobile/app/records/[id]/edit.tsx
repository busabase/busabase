import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RecordVO } from "busabase-contract/types";
import { getRecordTitle } from "busabase-core/dashboard/change-request";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeEmptyState,
  NativeInlineError,
  NativeLoadingState,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { RecordForm } from "~/domains/base/components/RecordForm";
import { useRecordFormDraft } from "~/domains/base/hooks/use-record-form-draft";
import { pendingChangeRequestId } from "~/domains/base/utils/change-request-result";
import { SUBMITTED_BY } from "~/domains/review/utils/submitted-by";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { useCurrentWorkspaceScope } from "~/domains/workspace/hooks/use-current-workspace-scope";
import { useMobileQueryRecovery } from "~/domains/workspace/hooks/use-mobile-query-recovery";
import { invalidateWorkspaceWrite } from "~/domains/workspace/utils/invalidate-workspace-write";
import { shortId } from "~/lib/format";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function EditRecordContent() {
  const params = useLocalSearchParams<{ id?: string }>();
  const recordId = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const currentScope = useCurrentWorkspaceScope(buda?.scopeKey);
  const queryClient = useQueryClient();
  const [discardOpen, setDiscardOpen] = useState(false);

  const recordOptions =
    buda && recordId
      ? buda.orpc.records.get.queryOptions({ input: { recordId } })
      : { queryKey: ["no-connection", "record", recordId], queryFn: skipToken as typeof skipToken };
  const recordQuery = useQuery(recordOptions);
  useMobileQueryRecovery(buda ? [recordOptions.queryKey] : []);
  const record = (recordQuery.data as RecordVO | undefined) ?? null;
  const draft = useRecordFormDraft({
    identity: `${buda?.scopeKey ?? "disconnected"}:record:${recordId}`,
    fields: record?.base.fields,
    source: record?.headCommit.payload,
  });

  const submitMutation = useMutation({
    mutationFn: async ({
      workspace,
      id,
      fields,
      title,
    }: {
      workspace: NonNullable<typeof buda>;
      id: string;
      fields: Record<string, unknown>;
      title: string;
    }) =>
      workspace.client.records.changeRequest({
        operation: "update",
        recordId: id,
        fields,
        message: `Update ${title}`,
        author: SUBMITTED_BY,
      }),
    onSuccess: (outcome, { workspace }) => {
      invalidateWorkspaceWrite(queryClient, workspace, outcome);
      if (currentScope.current !== workspace.scopeKey) return;
      const reviewId = pendingChangeRequestId(outcome);
      // Merged immediately (the write-capable case): `outcome.id` is the RECORD,
      // so send the user back to it rather than to a review page that does not
      // exist. Only a genuinely pending proposal has somewhere to review.
      router.replace(
        reviewId
          ? { pathname: "/change-requests/[id]", params: { id: reviewId } }
          : { pathname: "/records/[id]", params: { id: outcome.id } },
      );
    },
  });

  const hasChanges = draft.hasChanges;
  const closeForm = () => {
    if (submitMutation.isPending) {
      return;
    }
    if (hasChanges) {
      setDiscardOpen(true);
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/drawer/home");
    }
  };
  const discardChanges = () => {
    if (submitMutation.isPending) {
      return;
    }
    setDiscardOpen(false);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/drawer/home");
    }
  };

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={closeForm}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  if (recordQuery.isLoading) {
    return (
      <DrawerScaffold
        title="Edit record"
        subtitle={shortId(recordId)}
        headerLeading={headerLeading}
      >
        <NativeLoadingState label="Loading record" />
      </DrawerScaffold>
    );
  }

  if (!record) {
    return (
      <DrawerScaffold
        title="Edit record"
        subtitle={shortId(recordId)}
        headerLeading={headerLeading}
      >
        <NativeEmptyState title="Record not found" description="This record is not available." />
      </DrawerScaffold>
    );
  }

  return (
    <DrawerScaffold
      title="Edit record"
      subtitle={record.base.name}
      headerLeading={headerLeading}
      footer={
        <NativeActionBar>
          {draft.schemaChanged ? (
            <NativeInlineError message="Fields changed while you were editing. Your draft is kept; copy your changes and reopen this record." />
          ) : null}
          {submitMutation.error ? (
            <NativeInlineError
              message={submitMutation.error.message}
              onReset={() => submitMutation.reset()}
            />
          ) : null}
          <Button
            label="Save change request"
            loading={submitMutation.isPending}
            disabled={submitMutation.isPending || !hasChanges || draft.schemaChanged}
            fullWidth
            onPress={() => {
              if (!buda || !record || draft.schemaChanged) return;
              submitMutation.mutate({
                workspace: buda,
                id: record.id,
                fields: draft.changedValues,
                title: getRecordTitle(record),
              });
            }}
          />
        </NativeActionBar>
      }
    >
      <RecordForm fields={draft.fields} values={draft.values} onChange={draft.setValue} />
      <NativeBottomSheet
        visible={discardOpen}
        title="Discard changes?"
        description="This closes the record editor and removes unsaved field changes."
        showCloseButton
        onClose={() => setDiscardOpen(false)}
        footer={
          <NativeActionBar>
            <Button
              label="Discard changes"
              variant="destructive"
              disabled={submitMutation.isPending}
              fullWidth
              onPress={discardChanges}
            />
            <Button
              label="Keep editing"
              variant="ghost"
              disabled={submitMutation.isPending}
              fullWidth
              onPress={() => setDiscardOpen(false)}
            />
          </NativeActionBar>
        }
      />
    </DrawerScaffold>
  );
}

export default function EditRecordScreen() {
  return (
    <ConnectionGuard>
      <EditRecordContent />
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
});
