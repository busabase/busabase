import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BaseVO } from "busabase-contract/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeEmptyState,
  NativeInlineError,
  NativeLoadingState,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { RecordForm } from "~/domains/base/components/RecordForm";
import { useRecordFormDraft } from "~/domains/base/hooks/use-record-form-draft";
import { pendingChangeRequestId } from "~/domains/base/utils/change-request-result";
import { isEditableField, normalizeFormValues } from "~/domains/base/utils/record-form";
import { SUBMITTED_BY } from "~/domains/review/utils/submitted-by";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { useCurrentWorkspaceScope } from "~/domains/workspace/hooks/use-current-workspace-scope";
import { useMobileQueryRecovery } from "~/domains/workspace/hooks/use-mobile-query-recovery";
import { invalidateWorkspaceWrite } from "~/domains/workspace/utils/invalidate-workspace-write";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function NewRecordContent() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const currentScope = useCurrentWorkspaceScope(buda?.scopeKey);
  const queryClient = useQueryClient();

  const basesOptions = buda
    ? buda.orpc.bases.list.queryOptions({ input: {} })
    : { queryKey: ["no-connection", "bases", "list"], queryFn: skipToken as typeof skipToken };
  const basesQuery = useQuery(basesOptions);
  useMobileQueryRecovery(buda ? [basesOptions.queryKey] : []);
  const base: BaseVO | null = useMemo(
    () => basesQuery.data?.find((item) => item.slug === slug) ?? null,
    [basesQuery.data, slug],
  );

  const [discardOpen, setDiscardOpen] = useState(false);
  const draft = useRecordFormDraft({
    identity: `${buda?.scopeKey ?? "disconnected"}:new:${slug}`,
    fields: base?.fields,
  });

  const submitMutation = useMutation({
    mutationFn: async ({
      workspace,
      baseId,
      fields,
      name,
    }: {
      workspace: NonNullable<typeof buda>;
      baseId: string;
      fields: Record<string, unknown>;
      name: string;
    }) =>
      workspace.client.bases.createChangeRequest({
        baseId,
        fields,
        message: `Create ${name} record`,
        submittedBy: SUBMITTED_BY,
      }),
    onSuccess: (outcome, { workspace }) => {
      invalidateWorkspaceWrite(queryClient, workspace, outcome);
      if (currentScope.current !== workspace.scopeKey) return;
      const reviewId = pendingChangeRequestId(outcome);
      // Merged immediately: `outcome.id` is the new RECORD — open it, which is
      // what "I just created this" should land on anyway.
      router.replace(
        reviewId
          ? { pathname: "/change-requests/[id]", params: { id: reviewId } }
          : { pathname: "/records/[id]", params: { id: outcome.id } },
      );
    },
  });

  const hasChanges = draft.hasChanges;
  const editableFieldCount = base?.fields.filter(isEditableField).length ?? 0;
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

  if (basesQuery.isLoading) {
    return (
      <DrawerScaffold title="New record" subtitle={slug} headerLeading={headerLeading}>
        <NativeLoadingState label="Loading base" />
      </DrawerScaffold>
    );
  }

  if (!base) {
    return (
      <DrawerScaffold title="New record" subtitle={slug} headerLeading={headerLeading}>
        <NativeEmptyState title="Base not found" description="This base is not available." />
      </DrawerScaffold>
    );
  }

  return (
    <DrawerScaffold
      title="New record"
      subtitle={base.name}
      headerLeading={headerLeading}
      footer={
        <NativeActionBar>
          {draft.schemaChanged ? (
            <NativeInlineError message="Fields changed while you were editing. Your draft is kept; copy your changes and reopen this form." />
          ) : null}
          {submitMutation.error ? (
            <NativeInlineError
              message={submitMutation.error.message}
              onReset={() => submitMutation.reset()}
            />
          ) : null}
          <Button
            label="Create change request"
            loading={submitMutation.isPending}
            disabled={submitMutation.isPending || draft.schemaChanged}
            fullWidth
            onPress={() => {
              if (!buda || !base || draft.schemaChanged) return;
              submitMutation.mutate({
                workspace: buda,
                baseId: base.id,
                fields: normalizeFormValues(draft.fields, draft.values),
                name: base.name,
              });
            }}
          />
        </NativeActionBar>
      }
    >
      <NativeSection title="Fields" caption={`${editableFieldCount}`}>
        <RecordForm fields={draft.fields} values={draft.values} onChange={draft.setValue} />
      </NativeSection>
      <NativeBottomSheet
        visible={discardOpen}
        title="Discard changes?"
        description="This closes the new record form and removes unsaved field values."
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

export default function NewRecordScreen() {
  return (
    <ConnectionGuard>
      <NewRecordContent />
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
