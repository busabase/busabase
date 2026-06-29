import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import type { BaseVO } from "busabase-core/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { RecordForm } from "~/components/busabase/RecordForm";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeScreen,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import {
  buildInitialFormValues,
  normalizeFormValues,
  type RecordFormValue,
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

  useEffect(() => {
    if (base) setValues(buildInitialFormValues(base.fields));
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
    >
      <View style={styles.content}>
        <RecordForm
          fields={base.fields}
          values={values}
          onChange={(fieldSlug, value) =>
            setValues((current) => ({ ...current, [fieldSlug]: value }))
          }
        />
        {submitMutation.error ? (
          <NativeErrorState
            message={submitMutation.error.message}
            onRetry={() => submitMutation.reset()}
          />
        ) : null}
        <Button
          label="Create change request"
          loading={submitMutation.isPending}
          fullWidth
          onPress={() => submitMutation.mutate()}
        />
      </View>
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
  content: { marginHorizontal: 20, gap: 14 },
});
