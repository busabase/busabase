import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import type { BaseVO } from "busabase-contract/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { RecordForm } from "~/components/busabase/RecordForm";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeEmptyState,
  NativeInlineError,
  NativeLoadingState,
  NativeScreen,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import {
  buildInitialFormValues,
  normalizeFormValues,
  type RecordFormValue,
  recordFormValuesEqual,
} from "~/lib/record-form";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function NewRecordContent() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();

  const basesQuery = useQuery(
    buda
      ? buda.orpc.bases.list.queryOptions({})
      : { queryKey: ["no-connection", "bases", "list"], queryFn: skipToken },
  );
  const base: BaseVO | null = useMemo(
    () => basesQuery.data?.find((item) => item.slug === slug) ?? null,
    [basesQuery.data, slug],
  );

  const [values, setValues] = useState<Record<string, RecordFormValue>>({});
  const [initialValues, setInitialValues] = useState<Record<string, RecordFormValue>>({});
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    if (base) {
      const next = buildInitialFormValues(base.fields);
      setValues(next);
      setInitialValues(next);
    }
  }, [base]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!buda || !base) throw new Error("Not ready");
      return buda.client.bases.createChangeRequest({
        baseId: base.id,
        fields: normalizeFormValues(base.fields, values),
        message: `Create ${base.name} record`,
        submittedBy: "mobile-editor",
      });
    },
    onSuccess: (changeRequest) => {
      router.replace({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
    },
  });

  const hasChanges = base ? !recordFormValuesEqual(base.fields, initialValues, values) : false;
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
      router.replace("/drawer/inbox");
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
      router.replace("/drawer/inbox");
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
      <NativeScreen title="New record" subtitle={slug} headerLeading={headerLeading}>
        <NativeLoadingState label="Loading base" />
      </NativeScreen>
    );
  }

  if (!base) {
    return (
      <NativeScreen title="New record" subtitle={slug} headerLeading={headerLeading}>
        <NativeEmptyState title="Base not found" description="This base is not available." />
      </NativeScreen>
    );
  }

  return (
    <NativeScreen
      title={`New ${base.name}`}
      subtitle="Creates a change request for review"
      headerLeading={headerLeading}
      footer={
        <NativeActionBar>
          {submitMutation.error ? (
            <NativeInlineError
              message={submitMutation.error.message}
              onReset={() => submitMutation.reset()}
            />
          ) : null}
          <Button
            label="Create change request"
            loading={submitMutation.isPending}
            disabled={submitMutation.isPending}
            fullWidth
            onPress={() => submitMutation.mutate()}
          />
        </NativeActionBar>
      }
    >
      <NativeSection title="Fields" caption={`${base.fields.length}`}>
        <RecordForm
          fields={base.fields}
          values={values}
          onChange={(fieldSlug, value) =>
            setValues((current) => ({ ...current, [fieldSlug]: value }))
          }
        />
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
    </NativeScreen>
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
