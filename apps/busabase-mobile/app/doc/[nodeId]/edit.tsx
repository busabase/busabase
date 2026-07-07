import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, GitPullRequest, Save } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
  NativeScreen,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { useI18n } from "~/i18n";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const SUBMITTED_BY = "mobile-editor";

function countLines(value: string) {
  return value.length === 0 ? 0 : value.split(/\r\n|\r|\n/).length;
}

function countCharacters(value: string) {
  return Array.from(value).length;
}

function formatSignedCount(value: number, singular: string, plural = `${singular}s`) {
  const label = Math.abs(value) === 1 ? singular : plural;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString()} ${label}`;
}

function getBodyChangeSummary(before: string, after: string) {
  const lineDelta = countLines(after) - countLines(before);
  const characterDelta = countCharacters(after) - countCharacters(before);

  return `${formatSignedCount(lineDelta, "line")} · ${formatSignedCount(
    characterDelta,
    "character",
  )}`;
}

function DocEditContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const router = useRouter();
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const [body, setBody] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [changeMessage, setChangeMessage] = useState("");

  const docQuery = useQuery(
    buda && nodeId
      ? buda.orpc.docs.get.queryOptions({ input: { nodeId } })
      : { queryKey: ["no-connection", "doc", nodeId], queryFn: skipToken },
  );

  useEffect(() => {
    if (docQuery.data && !hydrated) {
      setBody(docQuery.data.body);
      setChangeMessage(`Update ${docQuery.data.node.name}`);
      setHydrated(true);
    }
  }, [docQuery.data, hydrated]);

  const title = docQuery.data?.node.name ?? "Doc";
  const originalBody = docQuery.data?.body ?? "";
  const unchanged = originalBody === body;
  const changeSummary = getBodyChangeSummary(originalBody, body);
  const defaultChangeMessage = title === "Doc" ? "Update doc" : `Update ${title}`;
  const customChangeMessage = changeMessage.trim();
  const hasUnsavedChanges =
    !unchanged || (customChangeMessage.length > 0 && customChangeMessage !== defaultChangeMessage);

  const createChangeRequestMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error("Not connected");
      return buda.client.docs.createChangeRequest({
        nodeId,
        body,
        message: changeMessage.trim() || defaultChangeMessage,
        submittedBy: SUBMITTED_BY,
      });
    },
    onSuccess: (changeRequest) =>
      router.replace({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } }),
  });

  const directSaveMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error("Not connected");
      return buda.client.docs.updateBody({ nodeId, body });
    },
    onSuccess: () =>
      router.replace({
        pathname: "/doc/[nodeId]",
        params: { nodeId },
      }),
  });

  const saving = directSaveMutation.isPending || createChangeRequestMutation.isPending;
  const goBack = () => {
    if (saving) {
      return;
    }
    if (hasUnsavedChanges) {
      setDiscardOpen(true);
      return;
    }
    router.canGoBack() ? router.back() : router.replace("/drawer/inbox");
  };
  const discardChanges = () => {
    if (saving) {
      return;
    }
    setDiscardOpen(false);
    router.canGoBack() ? router.back() : router.replace("/drawer/inbox");
  };

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={goBack}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  const actionError = directSaveMutation.error ?? createChangeRequestMutation.error;
  const resetActionErrors = () => {
    directSaveMutation.reset();
    createChangeRequestMutation.reset();
  };

  if (docQuery.isLoading) {
    return (
      <NativeScreen title={title} subtitle={t.common.edit} headerLeading={headerLeading}>
        <NativeLoadingState label={t.common.loading} />
      </NativeScreen>
    );
  }
  if (docQuery.error) {
    return (
      <NativeScreen title={title} subtitle={t.common.edit} headerLeading={headerLeading}>
        <NativeErrorState
          message={docQuery.error.message}
          onRetry={() => void docQuery.refetch()}
        />
      </NativeScreen>
    );
  }

  return (
    <NativeScreen
      title={title}
      subtitle={t.common.edit}
      headerLeading={headerLeading}
      footer={
        <NativeActionBar>
          {actionError ? (
            <NativeInlineError message={actionError.message} onReset={resetActionErrors} />
          ) : null}
          <Button
            label="Save"
            loading={saving}
            disabled={saving || unchanged}
            fullWidth
            leadingIcon={<Save size={18} color={tokens.primaryForeground} />}
            onPress={() => {
              resetActionErrors();
              if (!changeMessage.trim()) {
                setChangeMessage(defaultChangeMessage);
              }
              setSaveSheetOpen(true);
            }}
          />
        </NativeActionBar>
      }
    >
      <NativeSection title="Body" caption={unchanged ? "Saved" : changeSummary}>
        <View style={styles.editorWrap}>
          <TextInput
            value={body}
            multiline
            textAlignVertical="top"
            style={styles.editor}
            onChangeText={setBody}
          />
        </View>
      </NativeSection>
      <NativeBottomSheet
        visible={saveSheetOpen}
        title="Save doc"
        description={unchanged ? "No changes" : changeSummary}
        showCloseButton
        onClose={() => setSaveSheetOpen(false)}
        footer={
          <NativeActionBar>
            {actionError ? (
              <NativeInlineError message={actionError.message} onReset={resetActionErrors} />
            ) : null}
            <Button
              label="Direct save"
              variant="secondary"
              loading={directSaveMutation.isPending}
              disabled={saving || unchanged}
              fullWidth
              leadingIcon={<Save size={18} color={tokens.foreground} />}
              onPress={() => directSaveMutation.mutate()}
            />
            <Button
              label="Save as change request"
              loading={createChangeRequestMutation.isPending}
              disabled={saving || unchanged}
              fullWidth
              leadingIcon={<GitPullRequest size={18} color={tokens.primaryForeground} />}
              onPress={() => createChangeRequestMutation.mutate()}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={saving}
              fullWidth
              onPress={() => setSaveSheetOpen(false)}
            />
          </NativeActionBar>
        }
      >
        <View style={styles.sheetBody}>
          <TextInput
            label="Change request message"
            value={changeMessage}
            placeholder={defaultChangeMessage}
            onChangeText={setChangeMessage}
          />
        </View>
      </NativeBottomSheet>
      <NativeBottomSheet
        visible={discardOpen}
        title="Discard changes?"
        description="This closes the doc editor and removes unsaved body or change request message edits."
        showCloseButton
        onClose={() => setDiscardOpen(false)}
        footer={
          <NativeActionBar>
            <Button
              label="Discard changes"
              variant="destructive"
              disabled={saving}
              fullWidth
              onPress={discardChanges}
            />
            <Button
              label="Keep editing"
              variant="ghost"
              disabled={saving}
              fullWidth
              onPress={() => setDiscardOpen(false)}
            />
          </NativeActionBar>
        }
      />
    </NativeScreen>
  );
}

export default function DocEditScreen() {
  return (
    <ConnectionGuard>
      <DocEditContent />
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
  editorWrap: { paddingHorizontal: 14, paddingVertical: 12 },
  sheetBody: { paddingTop: 4 },
  editor: {
    minHeight: 280,
    paddingTop: 12,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 13,
    lineHeight: 19,
  },
});
