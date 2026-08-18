import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { CheckCircle2, Send } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { buildFormSubmissionValues, hasMissingRequiredFormValue } from "../utils/form-fields";
import { GeneratedFormField } from "./GeneratedFormField";

function FormNodeDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const buda = useBusabaseOrpc();
  const tokens = useTokens();
  const [values, setValues] = useState<Record<string, unknown>>({});

  const formQuery = useQuery(
    buda && nodeId
      ? { ...buda.orpc.forms.getByNode.queryOptions({ input: { nodeId } }), retry: false }
      : { queryKey: ["no-connection", "form", nodeId], queryFn: skipToken },
  );
  const submitMutation = useMutation({
    ...(buda
      ? buda.orpc.forms.submit.mutationOptions()
      : {
          mutationFn: async () => {
            throw new Error("Not connected");
          },
        }),
  });
  const form = formQuery.data ?? null;
  const fieldsBySlug = useMemo(
    () => new Map(form?.boundFields.map((field) => [field.slug, field]) ?? []),
    [form?.boundFields],
  );
  const missingRequired = useMemo(
    () => (form ? hasMissingRequiredFormValue(form.bindings, values) : false),
    [form, values],
  );
  const submit = () => {
    if (!buda || !form || missingRequired) return;
    submitMutation.mutate({
      nodeId,
      values: buildFormSubmissionValues(form.bindings, fieldsBySlug, values),
    });
  };

  return (
    <DrawerScaffold
      title={form?.name ?? "Form"}
      subtitle={form?.description || undefined}
      contentWidth="readable"
      refreshing={formQuery.isRefetching}
      onRefresh={() => void formQuery.refetch()}
      footer={
        form && !submitMutation.isSuccess && form.bindings.length > 0 ? (
          <NativeActionBar>
            <Button
              fullWidth
              label="Submit for review"
              loading={submitMutation.isPending}
              disabled={missingRequired}
              leadingIcon={<Send size={18} color={tokens.primaryForeground} />}
              onPress={submit}
            />
          </NativeActionBar>
        ) : undefined
      }
    >
      {formQuery.isLoading ? <NativeLoadingState label="Loading form" /> : null}
      {formQuery.error ? (
        <NativeErrorState
          message={formQuery.error.message}
          onRetry={() => void formQuery.refetch()}
        />
      ) : null}
      {!formQuery.isLoading && !formQuery.error && !form ? (
        <NativeEmptyState title="Form not configured" />
      ) : null}

      {form && submitMutation.isSuccess ? (
        <View style={styles.submitted}>
          <CheckCircle2 size={36} color={tokens.merged.text} />
          <Text style={[typography.h2, { color: tokens.foreground }]}>Submitted for review</Text>
          <Text style={[typography.small, styles.center, { color: tokens.mutedForeground }]}>
            Your response is waiting for approval.
          </Text>
        </View>
      ) : null}

      {form && !submitMutation.isSuccess ? (
        form.bindings.length > 0 ? (
          <View
            style={[styles.formPanel, { backgroundColor: tokens.card, borderColor: tokens.border }]}
          >
            {form.bindings.map((binding, index) => (
              <GeneratedFormField
                key={binding.inputName}
                binding={binding}
                field={fieldsBySlug.get(binding.fieldSlug)}
                last={index === form.bindings.length - 1 && !submitMutation.error}
                value={values[binding.inputName]}
                onChange={(value) =>
                  setValues((current) => ({ ...current, [binding.inputName]: value }))
                }
              />
            ))}
            {submitMutation.error ? (
              <View style={[styles.errorWrap, { borderColor: tokens.border }]}>
                <NativeInlineError
                  message={submitMutation.error.message}
                  onReset={() => submitMutation.reset()}
                />
              </View>
            ) : null}
          </View>
        ) : (
          <NativeEmptyState title="No fields" />
        )
      ) : null}
    </DrawerScaffold>
  );
}

export function FormNodeDetailScreen() {
  return (
    <ConnectionGuard>
      <FormNodeDetailContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  formPanel: {
    marginHorizontal: spacing[5],
    marginTop: spacing[5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  errorWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  submitted: {
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[10],
  },
  center: { textAlign: "center" },
});
