import type { BaseVO } from "busabase-core/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useBusabaseClient } from "~/api/use-busabase-client";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { RecordForm } from "~/components/busabase/RecordForm";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeScreen,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useNativeQuery } from "~/hooks/use-native-query";
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
  const client = useBusabaseClient();

  const loadBases = useCallback(() => client?.bases.list() ?? Promise.resolve([]), [client]);
  const basesQuery = useNativeQuery(!!client, loadBases);
  const base: BaseVO | null = useMemo(
    () => basesQuery.data?.find((item) => item.slug === slug) ?? null,
    [basesQuery.data, slug],
  );

  const [values, setValues] = useState<Record<string, RecordFormValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (base) {
      setValues(buildInitialFormValues(base.fields));
    }
  }, [base]);

  const submit = async () => {
    if (!client || !base) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const changeRequest = await client.bases.createChangeRequest({
        baseId: base.id,
        fields: normalizeFormValues(base.fields, values),
        message: `Create ${base.name} record`,
        submittedBy: "mobile-editor",
      });
      router.replace({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create change request");
    } finally {
      setSubmitting(false);
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

  if (basesQuery.loading) {
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
        {error ? <NativeErrorState message={error} onRetry={() => setError(null)} /> : null}
        <Button label="Create change request" loading={submitting} fullWidth onPress={submit} />
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
