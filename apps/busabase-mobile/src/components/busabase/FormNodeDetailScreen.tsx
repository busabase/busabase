import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { CheckCircle2, Send } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function FormNodeDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const buda = useBusabaseOrpc();
  const tokens = useTokens();
  const [values, setValues] = useState<Record<string, string>>({});

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
  const missingRequired = useMemo(
    () =>
      form?.bindings.some(
        (binding) => binding.required && !(values[binding.inputName] ?? "").trim(),
      ) ?? false,
    [form?.bindings, values],
  );
  const submit = () => {
    if (!buda || !form || missingRequired) return;
    submitMutation.mutate({ nodeId, values });
  };

  return (
    <DrawerScaffold
      title={form?.name ?? "Form"}
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
          <NativeSection title="Fields" caption={`${form.bindings.length}`}>
            <View style={styles.fields}>
              {form.bindings.map((binding) => (
                <View key={binding.inputName} style={styles.fieldWrap}>
                  <TextInput
                    label={`${binding.label ?? binding.fieldSlug}${binding.required ? " *" : ""}`}
                    value={values[binding.inputName] ?? ""}
                    onChangeText={(value) =>
                      setValues((current) => ({ ...current, [binding.inputName]: value }))
                    }
                  />
                  {binding.help ? (
                    <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                      {binding.help}
                    </Text>
                  ) : null}
                </View>
              ))}
              {submitMutation.error ? (
                <NativeInlineError
                  message={submitMutation.error.message}
                  onReset={() => submitMutation.reset()}
                />
              ) : null}
            </View>
          </NativeSection>
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
  fields: { paddingHorizontal: spacing[5], paddingVertical: spacing[4], gap: spacing[4] },
  fieldWrap: { gap: spacing[1] },
  submitted: {
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[10],
  },
  center: { textAlign: "center" },
});
