import type { RecordVO } from "busabase-core/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
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
import { getRecordTitle } from "~/lib/busabase-display";
import { shortId } from "~/lib/format";
import {
  buildInitialFormValues,
  normalizeFormValues,
  type RecordFormValue,
} from "~/lib/record-form";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function EditRecordContent() {
  const params = useLocalSearchParams<{ id?: string }>();
  const recordId = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const tokens = useTokens();
  const client = useBusabaseClient();

  const [record, setRecord] = useState<RecordVO | null>(null);
  const [values, setValues] = useState<Record<string, RecordFormValue>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || !recordId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await client.records.get({ recordId });
      setRecord(next);
      setValues(buildInitialFormValues(next.base.fields, next.headCommit.fields));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load record");
    } finally {
      setLoading(false);
    }
  }, [client, recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!client || !record) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const changeRequest = await client.records.updateChangeRequest({
        recordId: record.id,
        fields: normalizeFormValues(record.base.fields, values),
        message: `Update ${getRecordTitle(record)}`,
        author: "mobile-editor",
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

  if (loading) {
    return (
      <NativeScreen title="Edit record" subtitle={shortId(recordId)} headerLeading={headerLeading}>
        <NativeLoadingState label="Loading record" />
      </NativeScreen>
    );
  }

  if (!record) {
    return (
      <NativeScreen title="Edit record" subtitle={shortId(recordId)} headerLeading={headerLeading}>
        <NativeEmptyState title="Record not found" description="This record is not available." />
      </NativeScreen>
    );
  }

  return (
    <NativeScreen
      title={`Edit ${getRecordTitle(record)}`}
      subtitle="Proposes an update change request"
      headerLeading={headerLeading}
    >
      <View style={styles.content}>
        <RecordForm
          fields={record.base.fields}
          values={values}
          onChange={(fieldSlug, value) =>
            setValues((current) => ({ ...current, [fieldSlug]: value }))
          }
        />
        {error ? <NativeErrorState message={error} onRetry={() => setError(null)} /> : null}
        <Button label="Save change request" loading={submitting} fullWidth onPress={submit} />
      </View>
    </NativeScreen>
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
  content: { marginHorizontal: 20, gap: 14 },
});
