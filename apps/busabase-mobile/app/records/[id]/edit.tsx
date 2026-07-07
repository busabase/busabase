import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import type { RecordVO } from "busabase-contract/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
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
import { getRecordTitle } from "~/lib/busabase-display";
import { shortId } from "~/lib/format";
import {
  buildInitialFormValues,
  normalizeFormValues,
  type RecordFormValue,
  recordFormValuesEqual,
} from "~/lib/record-form";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function EditRecordContent() {
  const params = useLocalSearchParams<{ id?: string }>();
  const recordId = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const [values, setValues] = useState<Record<string, RecordFormValue>>({});
  const [initialValues, setInitialValues] = useState<Record<string, RecordFormValue>>({});
  const [discardOpen, setDiscardOpen] = useState(false);

  const recordQuery = useQuery(
    buda && recordId
      ? buda.orpc.records.get.queryOptions({ input: { recordId } })
      : { queryKey: ["no-connection", "record", recordId], queryFn: skipToken },
  );
  const record = (recordQuery.data as RecordVO | undefined) ?? null;

  useEffect(() => {
    if (record) {
      const next = buildInitialFormValues(record.base.fields, record.headCommit.fields);
      setValues(next);
      setInitialValues(next);
    }
  }, [record]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!buda || !record) throw new Error("Not ready");
      return buda.client.records.updateChangeRequest({
        recordId: record.id,
        fields: normalizeFormValues(record.base.fields, values),
        message: `Update ${getRecordTitle(record)}`,
        author: "mobile-editor",
      });
    },
    onSuccess: (changeRequest) => {
      router.replace({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
    },
  });

  const hasChanges = record
    ? !recordFormValuesEqual(record.base.fields, initialValues, values)
    : false;
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

  if (recordQuery.isLoading) {
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
      footer={
        <NativeActionBar>
          {submitMutation.error ? (
            <NativeInlineError
              message={submitMutation.error.message}
              onReset={() => submitMutation.reset()}
            />
          ) : null}
          <Button
            label="Save change request"
            loading={submitMutation.isPending}
            disabled={submitMutation.isPending || !hasChanges}
            fullWidth
            onPress={() => submitMutation.mutate()}
          />
        </NativeActionBar>
      }
    >
      <NativeSection title="Fields" caption={record.base.name}>
        <RecordForm
          fields={record.base.fields}
          values={values}
          variant="embedded"
          onChange={(fieldSlug, value) =>
            setValues((current) => ({ ...current, [fieldSlug]: value }))
          }
        />
      </NativeSection>
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
});
